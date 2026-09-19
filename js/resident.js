/* ============================================================
   Culiat Public Safety — Resident Dashboard (v5)
   + Enhanced type icons & pulse animations
   ============================================================ */

let currentUser = null;
let currentProfile = null;
let reportModal = null;
let residentDetailModal = null;
let allReports = [];
let mapInstance = null;
let mapMarker = null;
let mapInitialized = false;
let geocodeTimeout = null;
let isGeocoding = false;
let selectedMediaFiles = [];
let mediaPreviewUrls = [];

// Barangay map state (NEW)
let barangayMap = null;
let barangayMarkers = [];
let barangayIncidents = [];
let barangayRealtimeChannel = null;
let barangayRealtimeChannel2 = null;
let barangayBoundaryLayer = null;

// Gemini state
let geminiClient = null;
let geminiModel = null;
let geminiReady = false;
const aiCache = new Map();

// ============================================
// BARANGAY SCOPE — Tandang Sora, Quezon Ave, Congressional
// ============================================
const BARANGAY_SCOPE = {
  name: 'Barangay Culiat',
  bounds: {
    north: 14.7000,
    south: 14.6400,
    east: 121.0400,
    west: 120.9700
  },
  polygon: [
    [14.6990, 121.0150],
    [14.7020, 121.0280],
    [14.6980, 121.0380],
    [14.6880, 121.0420],
    [14.6750, 121.0400],
    [14.6650, 121.0330],
    [14.6580, 121.0250],
    [14.6550, 121.0150],
    [14.6580, 121.0050],
    [14.6680, 120.9980],
    [14.6780, 120.9930],
    [14.6880, 120.9900],
    [14.6960, 120.9950],
    [14.6990, 121.0050],
    [14.6990, 121.0150]
  ]
};

// ============================================
// INITIALIZE
// ============================================
async function initResidentDashboard() {
    try {
        console.log('📄 Initializing Resident Dashboard...');

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = '../index.html'; return; }

        currentUser = session.user;
        const { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();

        if (error) { showToast('Error loading profile', 'danger'); return; }

        if (!profile) {
            const { data: newProfile, error: createError } = await supabaseClient.from('profiles').insert([{
                id: currentUser.id, full_name: currentUser.user_metadata?.full_name || 'Resident',
                email: currentUser.email, barangay: currentUser.user_metadata?.barangay || 'Unknown',
                contact_number: currentUser.user_metadata?.contact_number || 'N/A', role: 'resident'
            }]).select().single();
            if (createError) { showToast('Error creating profile', 'danger'); return; }
            currentProfile = newProfile;
        } else { currentProfile = profile; }

        document.getElementById('userNameDisplay').textContent = currentProfile.full_name || 'Resident';
        reportModal = new bootstrap.Modal(document.getElementById('reportModal'));
        loadDashboard();

        document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const page = this.dataset.page;
                document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(l => l.classList.remove('active'));
                this.classList.add('active');
                loadPage(page);
            });
        });

        setupRealtime();

        if (window.location.hash === '#report') {
            setTimeout(() => { openReportModal(); window.location.hash = ''; }, 500);
        }

        document.getElementById('reportModal').addEventListener('shown.bs.modal', function() {
            if (!mapInitialized) { setTimeout(initMap, 300); }
            else if (mapInstance) { setTimeout(() => mapInstance.invalidateSize(), 300); }
        });

        document.getElementById('geolocateBtn')?.addEventListener('click', function() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(pos) {
                    const lat = pos.coords.latitude, lng = pos.coords.longitude;
                    if (mapInstance && mapMarker) {
                        mapInstance.setView([lat, lng], 16);
                        mapMarker.setLatLng([lat, lng]);
                        updateCoordDisplay(lat, lng);
                        reverseGeocode(lat, lng);
                        showToast('📍 Location updated from GPS', 'success');
                    }
                }, function() { showToast('Unable to get GPS location', 'danger'); });
            } else { showToast('Geolocation not supported', 'warning'); }
        });

        const locationInput = document.getElementById('incidentLocation');
        locationInput.addEventListener('input', function(e) {
            const query = this.value.trim();
            if (query.length < 3) { document.getElementById('geocodeSuggestions').classList.remove('show'); return; }
            clearTimeout(geocodeTimeout);
            geocodeTimeout = setTimeout(() => { searchLocation(query); }, 500);
        });

        locationInput.addEventListener('blur', function() { setTimeout(() => { document.getElementById('geocodeSuggestions').classList.remove('show'); }, 300); });
        locationInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); const query = this.value.trim(); if (query.length >= 3) searchLocation(query); }
        });

        setupMediaUpload();
        initGemini();

        console.log('✅ Resident Dashboard fully initialized');

    } catch (error) {
        console.error('❌ Init error:', error);
        showToast('Error loading dashboard', 'danger');
    }
}

// ============================================
// HELPERS
// ============================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getMediaUrls(report) {
    if (!report) return [];
    if (report.media_urls) {
        try {
            var urls = typeof report.media_urls === 'string' ? JSON.parse(report.media_urls) : report.media_urls;
            if (Array.isArray(urls) && urls.length > 0) return urls;
        } catch (e) {}
    }
    if (report.images) {
        try {
            var urls = typeof report.images === 'string' ? JSON.parse(report.images) : report.images;
            if (Array.isArray(urls) && urls.length > 0) return urls;
        } catch (e) {}
    }
    return [];
}

function getShortLocation(location) {
    if (!location) return 'Unknown location';
    var text = String(location);
    if (text.trim().startsWith('{')) {
        try {
            var obj = JSON.parse(text);
            if (obj && obj.address) text = String(obj.address);
        } catch (e) {}
    }
    var parts = text.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (parts.length > 2) {
        return parts.slice(0, 2).join(', ');
    }
    return text;
}

function getTypeIcon(type) {
    var map = {
        fire: 'fa-fire',
        medical: 'fa-heart-pulse',
        accident: 'fa-car-burst',
        flood: 'fa-water',
        crime: 'fa-shield-halved',
        armed_conflict: 'fa-shield-halved',
        natural_disaster: 'fa-water',
        other: 'fa-circle-exclamation'
    };
    return map[type] || 'fa-circle-exclamation';
}

function getTypeClass(type) {
    var map = {
        fire: 'fire', medical: 'medical', accident: 'accident',
        flood: 'flood', crime: 'crime', armed_conflict: 'crime',
        natural_disaster: 'flood', other: 'other'
    };
    return map[type] || 'other';
}

function getTypeColor(type) {
    var map = {
        fire: '#dc3545',
        medical: '#0d6efd',
        accident: '#fd7e14',
        flood: '#0dcaf0',
        crime: '#8b5cf6',
        armed_conflict: '#8b5cf6',
        natural_disaster: '#0dcaf0',
        other: '#6c757d'
    };
    return map[type] || map.other;
}

// Returns pulse classes for a given priority
function getPriorityPulseClasses(priority) {
    if (priority === 'critical') return { card: 'pulse-critical', icon: 'pulse-icon-critical' };
    if (priority === 'high') return { card: 'pulse-high', icon: '' };
    return { card: '', icon: '' };
}

// ============================================
// MEDIA UPLOAD
// ============================================
function setupMediaUpload() {
    const fileInput = document.getElementById('mediaUpload');
    const dropZone = document.getElementById('mediaDropZone');
    if (!fileInput || !dropZone) return;

    fileInput.addEventListener('change', function(e) { handleMediaFiles(this.files); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); this.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleMediaFiles(e.dataTransfer.files);
    });
    dropZone.addEventListener('click', function() { fileInput.click(); });
}

function handleMediaFiles(files) {
    const maxFiles = 5, maxSize = 10 * 1024 * 1024;
    if (selectedMediaFiles.length === 0) clearMediaPreviews();

    let validFiles = [], errorMessages = [];
    for (let file of files) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { errorMessages.push(`${file.name}: Unsupported file type`); continue; }
        if (file.size > maxSize) { errorMessages.push(`${file.name}: File too large (max 10MB)`); continue; }
        if (selectedMediaFiles.length + validFiles.length >= maxFiles) { errorMessages.push(`Maximum ${maxFiles} files allowed`); break; }
        validFiles.push(file);
    }

    if (errorMessages.length > 0) showToast(errorMessages.join('. '), 'warning', 6000);
    if (validFiles.length === 0) return;

    for (let file of validFiles) {
        selectedMediaFiles.push(file);
        const reader = new FileReader();
        reader.onload = function(e) { createMediaPreview(file, e.target.result); };
        reader.readAsDataURL(file);
    }
    updateMediaCount();
}

function createMediaPreview(file, dataUrl) {
    const container = document.getElementById('mediaPreviewContainer');
    const isVideo = file.type.startsWith('video/');
    const previewDiv = document.createElement('div');
    previewDiv.className = 'media-preview-item';
    previewDiv.dataset.index = container.children.length;

    if (isVideo) {
        previewDiv.innerHTML = `<video src="${dataUrl}" muted></video><div class="media-type-badge video"><i class="fas fa-video"></i></div><button class="remove-media-btn" onclick="removeMediaFile(${container.children.length})"><i class="fas fa-times"></i></button><div class="media-file-name">${file.name}</div>`;
    } else {
        previewDiv.innerHTML = `<img src="${dataUrl}" alt="${file.name}"><div class="media-type-badge image"><i class="fas fa-image"></i></div><button class="remove-media-btn" onclick="removeMediaFile(${container.children.length})"><i class="fas fa-times"></i></button><div class="media-file-name">${file.name}</div>`;
    }
    container.appendChild(previewDiv);
}

function removeMediaFile(index) {
    if (index >= 0 && index < selectedMediaFiles.length) {
        selectedMediaFiles.splice(index, 1);
        clearMediaPreviews();
        for (let file of selectedMediaFiles) {
            const reader = new FileReader();
            reader.onload = function(e) { createMediaPreview(file, e.target.result); };
            reader.readAsDataURL(file);
        }
        updateMediaCount();
    }
}

function clearMediaPreviews() { document.getElementById('mediaPreviewContainer').innerHTML = ''; }

function updateMediaCount() {
    const countDisplay = document.getElementById('mediaCount');
    if (countDisplay) countDisplay.textContent = `${selectedMediaFiles.length} / 5`;
}

async function uploadMediaFiles(incidentId) {
    if (selectedMediaFiles.length === 0) return [];
    const uploadedUrls = [], storageBucket = 'incident-media';

    for (let i = 0; i < selectedMediaFiles.length; i++) {
        const file = selectedMediaFiles[i];
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${incidentId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
            const { data, error } = await supabaseClient.storage.from(storageBucket).upload(fileName, file, { cacheControl: '3600', upsert: false });
            if (error) { showToast(`Failed to upload ${file.name}: ${error.message}`, 'warning'); continue; }
            const { data: urlData } = supabaseClient.storage.from(storageBucket).getPublicUrl(fileName);
            const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
            uploadedUrls.push({ url: urlData.publicUrl, type: mediaType, name: file.name, size: file.size });
        } catch (error) { showToast(`Error uploading ${file.name}`, 'danger'); }
    }
    return uploadedUrls;
}

// ============================================
// MAP FUNCTIONS (REPORT MODAL)
// ============================================
function initMap() {
    if (mapInitialized) return;
    const mapContainer = document.getElementById('incidentMap');
    if (!mapContainer) return;

    const defaultLat = 14.6760, defaultLng = 121.0150;
    mapInstance = L.map('incidentMap').setView([defaultLat, defaultLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);

    L.polygon(BARANGAY_SCOPE.polygon, {
        color: '#2e7d32',
        weight: 2,
        opacity: 0.8,
        fillColor: '#2e7d32',
        fillOpacity: 0.08,
        dashArray: '8 4'
    }).addTo(mapInstance);

    mapMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(mapInstance);
    updateCoordDisplay(defaultLat, defaultLng);

    mapMarker.on('dragend', function(e) { const pos = mapMarker.getLatLng(); updateCoordDisplay(pos.lat, pos.lng); reverseGeocode(pos.lat, pos.lng); });
    mapInstance.on('click', function(e) { const lat = e.latlng.lat, lng = e.latlng.lng; mapMarker.setLatLng([lat, lng]); updateCoordDisplay(lat, lng); reverseGeocode(lat, lng); });
    mapInitialized = true;
}

function updateCoordDisplay(lat, lng) {
    document.getElementById('incidentLat').value = lat;
    document.getElementById('incidentLng').value = lng;
    document.getElementById('coordDisplay').textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
}

async function searchLocation(query) {
    const suggestions = document.getElementById('geocodeSuggestions'), spinner = document.getElementById('searchSpinner');
    if (isGeocoding) return;
    isGeocoding = true;
    spinner.classList.add('show');

    try {
        const viewbox = `${BARANGAY_SCOPE.bounds.west},${BARANGAY_SCOPE.bounds.north},${BARANGAY_SCOPE.bounds.east},${BARANGAY_SCOPE.bounds.south}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=ph&viewbox=${viewbox}&bounded=1`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' } });
        const data = await response.json();
        spinner.classList.remove('show');

        if (data && data.length > 0) {
            suggestions.innerHTML = data.map(item => `<div class="geocode-suggestion-item" data-lat="${item.lat}" data-lon="${item.lon}" data-display="${item.display_name}"><i class="fas fa-map-pin text-danger me-2"></i><span>${item.display_name}</span></div>`).join('');
            suggestions.classList.add('show');
            suggestions.querySelectorAll('.geocode-suggestion-item').forEach(el => {
                el.addEventListener('click', function() {
                    const lat = parseFloat(this.dataset.lat), lon = parseFloat(this.dataset.lon), display = this.dataset.display;
                    document.getElementById('incidentLocation').value = display;
                    suggestions.classList.remove('show');
                    if (mapInstance && mapMarker) { mapInstance.setView([lat, lon], 16); mapMarker.setLatLng([lat, lon]); updateCoordDisplay(lat, lon); }
                });
            });
        } else { suggestions.classList.remove('show'); }
    } catch (error) { suggestions.classList.remove('show'); }
    finally { isGeocoding = false; spinner.classList.remove('show'); }
}

async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' } });
        const data = await response.json();
        if (data && data.display_name) document.getElementById('incidentLocation').value = data.display_name;
    } catch (error) { console.error('Reverse geocoding error:', error); }
}

// ============================================
// BARANGAY LIVE MAP — Shows resident + FB reports
// ============================================
function initBarangayMap() {
    const mapEl = document.getElementById('barangayMap');
    if (!mapEl || barangayMap) return;

    barangayMap = L.map('barangayMap', {
        zoomControl: true,
        attributionControl: false
    }).setView([14.6760, 121.0150], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(barangayMap);

    barangayBoundaryLayer = L.polygon(BARANGAY_SCOPE.polygon, {
        color: '#2e7d32',
        weight: 2.5,
        opacity: 0.85,
        fillColor: '#2e7d32',
        fillOpacity: 0.06,
        dashArray: '10 5',
        className: 'barangay-boundary'
    }).addTo(barangayMap);

    barangayBoundaryLayer.bindTooltip('Barangay Culiat Scope', {
        permanent: false,
        direction: 'center',
        className: 'barangay-tooltip'
    });

    barangayMap.fitBounds(barangayBoundaryLayer.getBounds(), { padding: [20, 20] });

    loadBarangayIncidentsOnMap();
    setupBarangayRealtime();

    setTimeout(function() {
        if (barangayMap) barangayMap.invalidateSize();
    }, 300);
}

// ============================================
// LOAD INCIDENTS FROM MULTIPLE SOURCES
// ============================================
async function loadBarangayIncidentsOnMap() {
    if (!barangayMap) return;

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sinceIso = thirtyDaysAgo.toISOString();

        const { data: incidentReports, error: err1 } = await supabaseClient
            .from('incident_reports')
            .select('*')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(100);

        if (err1) console.warn('incident_reports fetch error:', err1);

        const { data: emergencyReports, error: err2 } = await supabaseClient
            .from('emergencies')
            .select('*')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(100);

        if (err2) console.warn('emergencies fetch error:', err2);

        const fromResidents = (incidentReports || []).map(r => normalizeIncidentRow(r, 'resident'));
        const fromFacebook = (emergencyReports || []).map(r => normalizeIncidentRow(r, 'facebook'));

        const combined = [...fromResidents, ...fromFacebook];
        const seen = new Set();
        const deduped = [];
        for (const inc of combined) {
            const key = `${inc.type}|${inc.title}|${inc.created_at}|${inc._lat}|${inc._lng}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(inc);
        }

        deduped.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        barangayIncidents = deduped;
        renderBarangayMarkers(barangayIncidents);
        updateMapStatusBar(barangayIncidents);
    } catch (err) {
        console.warn('Failed to load barangay incidents:', err);
    }
}

// Normalize any row (from incident_reports OR emergencies) into one shape
function normalizeIncidentRow(row, source) {
    let coords = extractCoordinates(row.location);

    if (!coords && row.latitude != null && row.longitude != null) {
        coords = { lat: parseFloat(row.latitude), lng: parseFloat(row.longitude) };
    }
    if (!coords && row.lat != null && row.lng != null) {
        coords = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
    }

    return {
        id: row.id,
        type: row.type || 'other',
        title: row.title || 'Untitled Incident',
        description: row.description || '',
        location: row.location,
        priority: row.priority || 'medium',
        status: row.status || 'reported',
        created_at: row.created_at,
        barangay: row.barangay || null,
        contact_number: row.contact_number || row.reporter_phone || null,
        reporter_name: row.reporter_name || null,
        ai_analysis: row.ai_analysis || row.ai_classification || null,
        source: source,
        _lat: coords ? coords.lat : null,
        _lng: coords ? coords.lng : null
    };
}

function renderBarangayMarkers(incidents) {
    if (!barangayMap) return;

    barangayMarkers.forEach(function(m) { try { barangayMap.removeLayer(m); } catch(e) {} });
    barangayMarkers = [];

    incidents.forEach(function(incident) {
        const coords = (incident._lat != null && incident._lng != null)
            ? { lat: incident._lat, lng: incident._lng }
            : extractCoordinates(incident.location);
        if (!coords) return;

        const type = incident.type || 'other';
        const typeIcon = getTypeIcon(type);
        const typeClass = getTypeClass(type);
        const priority = incident.priority || 'medium';
        const status = incident.status || 'reported';
        const isResolved = status === 'resolved' || status === 'closed';
        const isFacebook = incident.source === 'facebook';

        const badgeHTML = isFacebook
            ? `<span style="position:absolute;top:-2px;right:-2px;background:#0084FF;color:#fff;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;border:1.5px solid #fff;font-weight:900;">f</span>`
            : '';

        const iconHtml = `
            <div class="marker-pin ${typeClass} ${priority} ${isResolved ? 'resolved' : ''}" style="position:relative;">
                <div class="marker-pulse-ring"></div>
                <i class="fas ${typeIcon}"></i>
                ${badgeHTML}
            </div>
        `;

        const customIcon = L.divIcon({
            html: iconHtml,
            className: 'custom-incident-marker',
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        });

        const marker = L.marker([coords.lat, coords.lng], { icon: customIcon }).addTo(barangayMap);

        const createdDate = incident.created_at
            ? new Date(incident.created_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })
            : 'Unknown';

        const shortDesc = incident.description
            ? String(incident.description).substring(0, 100) + (String(incident.description).length > 100 ? '…' : '')
            : 'No description';

        const sourceBadge = isFacebook
            ? `<span style="background:#0084FF;color:#fff;font-size:0.6rem;padding:2px 8px;border-radius:9999px;font-weight:800;display:inline-flex;align-items:center;gap:3px;"><i class="fab fa-facebook-messenger"></i>FB</span>`
            : `<span style="background:var(--muted);color:var(--muted-foreground);font-size:0.6rem;padding:2px 8px;border-radius:9999px;font-weight:800;">Resident</span>`;

        const popupHtml = `
            <div class="map-popup-content">
                <div class="map-popup-title">
                    <i class="fas ${typeIcon}" style="color:${getTypeColor(type)};"></i>
                    ${escapeHtml(incident.title || 'Untitled')}
                </div>
                <div class="map-popup-badges">
                    ${sourceBadge}
                    <span class="badge priority-${priority}" style="font-size:0.62rem;padding:3px 10px;border-radius:50px;text-transform:uppercase;">${priority}</span>
                    <span class="status-badge status-${status}" style="font-size:0.62rem;padding:3px 10px;">${status}</span>
                </div>
                <div class="map-popup-meta">
                    <span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(getShortLocation(incident.location))}</span>
                    <span><i class="fas fa-clock"></i> ${createdDate}</span>
                    <span><i class="fas fa-align-left"></i> ${escapeHtml(shortDesc)}</span>
                </div>
                <button class="map-popup-btn" onclick="viewResidentIncidentDetail('${incident.id}', '${incident.source}')">
                    <i class="fas fa-eye"></i> View Details
                </button>
            </div>
        `;

        marker.bindPopup(popupHtml, {
            maxWidth: 280,
            minWidth: 220,
            closeButton: true,
            autoPan: true,
            className: 'incident-popup'
        });

        barangayMarkers.push(marker);
    });
}

function updateMapStatusBar(incidents) {
    var bar = document.getElementById('mapStatusBar');
    if (!bar) return;

    var activeCount = incidents.filter(function(i) {
        return !['resolved', 'closed', 'processed'].includes(i.status);
    }).length;

    var criticalCount = incidents.filter(function(i) {
        return i.priority === 'critical' && !['resolved', 'closed', 'processed'].includes(i.status);
    }).length;

    var fbCount = incidents.filter(function(i) {
        return i.source === 'facebook' && !['resolved', 'closed', 'processed'].includes(i.status);
    }).length;

    var text = activeCount === 0
        ? 'All clear in your barangay'
        : activeCount + ' active incident' + (activeCount > 1 ? 's' : '');

    if (criticalCount > 0) {
        text = '🚨 ' + criticalCount + ' CRITICAL incident' + (criticalCount > 1 ? 's' : '') + ' in your barangay';
    } else if (fbCount > 0) {
        text += ' · 📘 ' + fbCount + ' from Facebook';
    }

    bar.innerHTML = '<span class="map-live-dot"></span>' + escapeHtml(text);
}

function extractCoordinates(location) {
    if (!location) return null;

    if (typeof location === 'string' && location.trim().startsWith('{')) {
        try {
            var obj = JSON.parse(location);
            if (obj.latitude != null && obj.longitude != null) {
                return { lat: parseFloat(obj.latitude), lng: parseFloat(obj.longitude) };
            }
        } catch (e) {}
    }

    if (typeof location === 'object' && location.latitude != null && location.longitude != null) {
        return { lat: parseFloat(location.latitude), lng: parseFloat(location.longitude) };
    }

    if (typeof location === 'string') {
        var match = location.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
        if (match) {
            return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
    }

    return null;
}

function setupBarangayRealtime() {
    if (barangayRealtimeChannel) {
        try { supabaseClient.removeChannel(barangayRealtimeChannel); } catch (e) {}
    }
    if (barangayRealtimeChannel2) {
        try { supabaseClient.removeChannel(barangayRealtimeChannel2); } catch (e) {}
    }

    barangayRealtimeChannel = supabaseClient
        .channel('barangay-map-live-residents')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'incident_reports'
        }, function(payload) {
            if (!payload.new) return;
            handleNewMapIncident(payload.new, 'resident');
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'incident_reports'
        }, function(payload) {
            if (!payload.new) return;
            handleUpdateMapIncident(payload.new, 'resident');
        })
        .subscribe();

    barangayRealtimeChannel2 = supabaseClient
        .channel('barangay-map-live-facebook')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'emergencies'
        }, function(payload) {
            if (!payload.new) return;
            handleNewMapIncident(payload.new, 'facebook');
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'emergencies'
        }, function(payload) {
            if (!payload.new) return;
            handleUpdateMapIncident(payload.new, 'facebook');
        })
        .subscribe();
}

function handleNewMapIncident(newRow, source) {
    const normalized = normalizeIncidentRow(newRow, source);

    const coords = normalized._lat != null && normalized._lng != null
        ? { lat: normalized._lat, lng: normalized._lng }
        : extractCoordinates(normalized.location);
    if (!coords) return;
    if (!isInsideBarangay(coords.lat, coords.lng)) return;

    const exists = barangayIncidents.find(function(i) { return i.id === normalized.id; });
    if (exists) return;

    barangayIncidents.unshift(normalized);
    renderBarangayMarkers(barangayIncidents);
    updateMapStatusBar(barangayIncidents);

    const label = source === 'facebook' ? 'Facebook report' : 'New incident';
    if (normalized.priority === 'critical') {
        showToast('🚨 CRITICAL ' + label + ' in your barangay: ' + (normalized.title || ''), 'emergency', 8000);
    } else {
        showToast('📢 ' + label + ': ' + (normalized.title || ''), 'warning', 6000);
    }
}

function handleUpdateMapIncident(newRow, source) {
    const idx = barangayIncidents.findIndex(function(i) { return i.id === newRow.id; });
    if (idx >= 0) {
        const normalized = normalizeIncidentRow(newRow, source);
        if (normalized._lat == null) {
            normalized._lat = barangayIncidents[idx]._lat;
            normalized._lng = barangayIncidents[idx]._lng;
        }
        barangayIncidents[idx] = Object.assign({}, barangayIncidents[idx], normalized);
        renderBarangayMarkers(barangayIncidents);
        updateMapStatusBar(barangayIncidents);
    } else {
        handleNewMapIncident(newRow, source);
    }
}

function addSingleMarker(incident) {
    renderBarangayMarkers(barangayIncidents);
}

function isInsideBarangay(lat, lng) {
    var b = BARANGAY_SCOPE.bounds;
    return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

// ============================================
// AI ANALYSIS — GEMINI + RULE-BASED FALLBACK
// ============================================
function initGemini() {
    try {
        console.log('🔍 Checking Gemini setup...');

        if (!window.GEMINI_CONFIG) {
            console.warn('❌ window.GEMINI_CONFIG is undefined — gemini-config.js not loaded');
            return false;
        }
        if (!window.GEMINI_CONFIG.API_KEY || window.GEMINI_CONFIG.API_KEY.indexOf('PASTE_YOUR') !== -1) {
            console.warn('❌ API key not set in gemini-config.js');
            return false;
        }
        if (typeof window.GoogleGenerativeAI === 'undefined') {
            console.warn('❌ GoogleGenerativeAI SDK not loaded — check script tag in HTML');
            return false;
        }

        geminiClient = new window.GoogleGenerativeAI(window.GEMINI_CONFIG.API_KEY);
        geminiModel = geminiClient.getGenerativeModel({
            model: window.GEMINI_CONFIG.MODEL || 'gemini-3.6-flash',
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 500,
                responseMimeType: 'application/json'
            }
        });
        geminiReady = true;
        console.log('✅ Gemini AI ready:', window.GEMINI_CONFIG.MODEL);
        return true;
    } catch (e) {
        console.warn('❌ Gemini init failed:', e);
        geminiReady = false;
        return false;
    }
}

const TYPE_DETECTION_KEYWORDS = {
    fire: ['fire', 'flame', 'smoke', 'burn', 'burning', 'blaze', 'wildfire', 'sunog', 'apoy', 'usok', 'nagniningas', 'nasusunog', 'nasunog'],
    medical: ['medical', 'injury', 'injured', 'sick', 'pain', 'chest pain', 'heart', 'breathing', 'unconscious', 'bleeding', 'faint', 'seizure', 'stroke', 'hospital', 'ambulance', 'doctor', 'nurse', 'patient', 'medikal', 'sakit', 'sugat', 'nasugatan', 'hindi humihinga', 'walang malay', 'dugo', 'atake', 'hilo', 'nahihilo', 'ospital', 'doktor'],
    accident: ['accident', 'crash', 'collision', 'vehicle', 'car', 'motorcycle', 'truck', 'jeepney', 'tricycle', 'bike', 'fell', 'fall', 'hit', 'run over', 'aksidente', 'bangga', 'bumangga', 'nasagasaan', 'nahulog', 'nasalpok', 'sasakyan', 'kotse', 'motor'],
    flood: ['flood', 'flooding', 'flooded', 'water rising', 'overflow', 'river', 'rain', 'typhoon', 'storm', 'drowning', 'submerged', 'baha', 'pagbaha', 'binaha', 'tubig', 'ilog', 'ulan', 'bagyo', 'lunod'],
    crime: ['crime', 'rob', 'robbery', 'theft', 'steal', 'stolen', 'thief', 'burglar', 'attack', 'assault', 'fight', 'weapon', 'gun', 'knife', 'shooting', 'stab', 'stabbed', 'murder', 'homicide', 'holdap', 'krimen', 'holdap', 'nakaw', 'ninakaw', 'magnanakaw', 'pananakit', 'sinaktan', 'away', 'baril', 'kutsilyo', 'saksak', 'sinaksak', 'patayan']
};

function detectIncidentType(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    const scores = { fire: 0, medical: 0, accident: 0, flood: 0, crime: 0 };

    Object.keys(TYPE_DETECTION_KEYWORDS).forEach(function(type) {
        TYPE_DETECTION_KEYWORDS[type].forEach(function(kw) {
            if (kw.indexOf(' ') !== -1) {
                if (text.indexOf(kw) !== -1) scores[type]++;
            } else {
                const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                if (re.test(text)) scores[type]++;
            }
        });
    });

    let detectedType = 'other';
    let maxScore = 0;
    Object.keys(scores).forEach(function(type) {
        if (scores[type] > maxScore) {
            maxScore = scores[type];
            detectedType = type;
        }
    });

    if (maxScore === 0) detectedType = 'other';

    return { type: detectedType, score: maxScore, allScores: scores };
}

const AI_KEYWORDS = {
    critical: {
        3: ['explosion', 'exploded', 'shooting', 'shot', 'stabbing', 'stabbed', 'unconscious', 'not breathing', 'no pulse', 'severe bleeding', 'heart attack', 'stroke', 'cardiac arrest', 'drowning', 'drowned', 'gas leak', 'building collapse', 'collapsed', 'trapped', 'electrocuted', 'electrocution', 'seizure', 'choking', 'overdose', 'pagsabog', 'sumabog', 'bumaril', 'sinaksak', 'saksak', 'walang malay', 'hindi humihinga', 'walang pulso', 'matinding pagdurugo', 'atake sa puso', 'paglunod', 'nalunod', 'pagtagas ng gas', 'gumuhong gusali', 'naipit', 'nakuryente', 'kombulsyon', 'nasasakal'],
        2: ['fire', 'burning', 'flames', 'smoke', 'sunog', 'nasusunog', 'nagniningas', 'usok']
    },
    high: {
        2: ['accident', 'collision', 'crash', 'flood', 'flooding', 'robbery', 'holdap', 'assault', 'attacked', 'chest pain', 'difficulty breathing', 'heavy bleeding', 'fracture', 'broken bone', 'head injury', 'burns', 'landslide', 'earthquake', 'typhoon', 'aksidente', 'banggaan', 'bumangga', 'baha', 'pagbaha', 'pananakit', 'sinaktan', 'sakit sa dibdib', 'hirap huminga', 'bali', 'baling buto', 'pinsala sa ulo', 'pagguho', 'lindol', 'bagyo'],
        1: ['injured', 'injury', 'wounded', 'bleeding', 'sugatan', 'nasugatan', 'dugo']
    },
    medium: {
        1: ['medical', 'suspicious', 'theft', 'stolen', 'vandalism', 'fight', 'argument', 'noise', 'disturbance', 'fallen tree', 'power outage', 'medikal', 'kahina-hinala', 'pagnanakaw', 'ninakaw', 'bandalismo', 'away', 'gulo', 'ingay', 'nahulog na puno', 'walang kuryente']
    }
};

const NEGATION_WORDS = ['no', 'not', 'none', 'without', 'false alarm', 'walang', 'wala', 'hindi', 'huwag'];
const FAKE_INDICATORS = ['test', 'testing', 'asdf', 'qwerty', 'joke', 'prank', 'lol', 'haha', 'hehe', 'fake', 'sample', 'dummy', 'biruan', 'biro', 'kalokohan', 'peke', 'pagsubok'];

function aiNormalize(text) {
    return String(text || '').toLowerCase().replace(/[^\w\sáéíóúñàèìòùâêîôûäëïöü]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function aiContainsWord(text, word) {
    if (!word) return false;
    if (word.indexOf(' ') !== -1) return text.indexOf(word) !== -1;
    var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    return re.test(text);
}

function aiIsNegated(text, word) {
    var idx = text.indexOf(word);
    if (idx === -1) return false;
    var before = text.substring(Math.max(0, idx - 40), idx).trim();
    var words = before.split(/\s+/).slice(-4);
    return words.some(function(w) { return NEGATION_WORDS.indexOf(w.toLowerCase()) !== -1; });
}

function aiIsNonsense(text) {
    if (!text || text.length < 8) return true;
    if (/(.)\1{4,}/.test(text)) return true;
    for (var i = 0; i < FAKE_INDICATORS.length; i++) {
        if (aiContainsWord(text, FAKE_INDICATORS[i])) return true;
    }
    var vowels = text.match(/[aeiouáéíóúàèìòùâêîôûäëïöü]/gi);
    if (text.length > 6 && (!vowels || vowels.length < text.length * 0.1)) return true;
    return false;
}

function enhancedAIAnalysis(type, description, location, title) {
    var normDesc = aiNormalize(description || '');
    var normTitle = aiNormalize(title || '');
    var normLoc = aiNormalize(location || '');
    var text = (normTitle + ' ' + normDesc + ' ' + normLoc).trim();

    var isNonsense = aiIsNonsense(normDesc) && aiIsNonsense(normTitle);

    var score = 0;
    var matched = [];

    Object.keys(AI_KEYWORDS).forEach(function(cat) {
        Object.keys(AI_KEYWORDS[cat]).forEach(function(w) {
            AI_KEYWORDS[cat][w].forEach(function(kw) {
                if (aiContainsWord(text, kw) && !aiIsNegated(text, kw)) {
                    score += parseInt(w, 10);
                    matched.push(kw);
                }
            });
        });
    });

    var typeBoost = 0;
    if (['fire','medical','accident','flood','crime'].indexOf(type) !== -1) typeBoost = 1;
    var finalScore = score + typeBoost;

    var priority = 'low', confidence = 0.70;
    if (isNonsense) { priority = 'low'; confidence = 0.40; }
    else if (finalScore >= 8) { priority = 'critical'; confidence = 0.92; }
    else if (finalScore >= 5) { priority = 'high'; confidence = 0.84; }
    else if (finalScore >= 2) { priority = 'medium'; confidence = 0.76; }
    else { priority = 'low'; confidence = 0.68; }

    return {
        priority: priority,
        confidence: confidence,
        actions: getActionsForType(type),
        verification: getVerificationText(priority, confidence),
        reasoning: ['Local analysis: ' + (matched.length ? 'matched ' + matched.slice(0,5).join(', ') : 'no strong keywords — try adding more detail')],
        detectedLanguage: 'unknown',
        isNonsense: isNonsense,
        source: 'rule-based'
    };
}

async function analyzeWithGemini(type, title, description, location) {
    if (!geminiReady || !geminiModel) throw new Error('Gemini not ready');

    const cacheKey = `${type}|${title}|${description}|${location}`.toLowerCase().slice(0, 200);
    if (window.GEMINI_CONFIG.ENABLE_CACHE && aiCache.has(cacheKey)) {
        const cached = aiCache.get(cacheKey);
        if (Date.now() - cached.ts < window.GEMINI_CONFIG.CACHE_TTL_MS) {
            console.log('🎯 AI cache hit');
            return cached.result;
        }
    }

    const prompt = `You are an emergency dispatcher for a Barangay (village) emergency response system in the Philippines.

Analyze the incident report below. You MUST understand English, Tagalog, and mixed Taglish.

Title: ${title}
Description: ${description}
Location: ${location}
User-selected type: ${type}

TASK 1 — DETECT INCIDENT TYPE:
Determine the actual incident type from the text. Choose ONE of:
- "fire" (sunog, apoy, usok, nasusunog)
- "medical" (sakit, sugat, ospital, hindi humihinga, atake)
- "accident" (aksidente, bangga, nasagasaan, nahulog)
- "flood" (baha, pagbaha, binaha, paglunod)
- "crime" (holdap, nakaw, saksak, baril, away, pananakit)
- "other" (none of the above)

TASK 2 — DETECT PRIORITY:
- "critical" = Life-threatening, immediate dispatch.
- "high" = Serious, prompt response.
- "medium" = Attention needed.
- "low" = Non-urgent, unclear, nonsense, or test message.

RULES:
- If text is gibberish, return priority "low", confidence below 0.5.
- If type is "fire" but says "no fire" or "walang sunog", do NOT mark critical.

Return ONLY this JSON:
{
  "detectedType": "fire" | "medical" | "accident" | "flood" | "crime" | "other",
  "priority": "critical" | "high" | "medium" | "low",
  "confidence": 0.0,
  "reasoning": "One sentence.",
  "detectedLanguage": "english" | "tagalog" | "taglish" | "other",
  "isNonsense": false
}`;

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();
    text = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('Invalid AI response format');
    }

    const validTypes = ['fire', 'medical', 'accident', 'flood', 'crime', 'other'];
    const detectedType = validTypes.indexOf(parsed.detectedType) !== -1 ? parsed.detectedType : type;

    const priority = ['critical','high','medium','low'].indexOf(parsed.priority) !== -1 ? parsed.priority : 'medium';
    const confidence = Math.min(0.99, Math.max(0.5, parseFloat(parsed.confidence) || 0.75));

    const aiResult = {
        priority: priority,
        confidence: confidence,
        actions: getActionsForType(detectedType),
        verification: getVerificationText(priority, confidence),
        reasoning: [parsed.reasoning || 'AI classification completed'],
        detectedLanguage: parsed.detectedLanguage || 'unknown',
        detectedType: detectedType,
        isNonsense: !!parsed.isNonsense,
        source: 'gemini'
    };

    if (window.GEMINI_CONFIG.ENABLE_CACHE) {
        aiCache.set(cacheKey, { result: aiResult, ts: Date.now() });
    }

    return aiResult;
}

function getActionsForType(type) {
    const map = {
        fire:     ['Evacuate immediately', 'Call fire department (BFP)', 'Use extinguisher only if safe', 'Avoid smoke inhalation'],
        medical:  ['Call ambulance (911)', 'Perform CPR if trained', 'Keep victim calm', 'Do not move injured person'],
        accident: ['Call emergency services', 'Secure the area', 'Provide first aid if safe', 'Direct traffic away'],
        flood:    ['Move to higher ground', 'Turn off electricity', 'Avoid walking in floodwater', 'Secure documents'],
        crime:    ['Ensure your safety first', 'Call police (117)', 'Do not confront suspects', 'Preserve evidence'],
        other:    ['Assess the situation', 'Call emergency services if needed', 'Provide assistance if safe']
    };
    return map[type] || map.other;
}

function getVerificationText(priority, confidence) {
    if (priority === 'critical') return '🔴 Urgent: dispatch responders immediately';
    if (priority === 'high')     return '🟠 High priority: verify within 5 minutes';
    if (priority === 'medium')   return '🟡 Schedule verification within 10–15 minutes';
    return '🟢 Low priority: routine follow-up';
}

async function analyzeWithAI() {
    const typeSelect = document.getElementById('incidentType');
    const type  = typeSelect.value;
    const title = document.getElementById('incidentTitle').value.trim();
    const desc  = document.getElementById('incidentDescription').value.trim();
    const loc   = document.getElementById('incidentLocation').value.trim();

    if (!desc && !title) {
        showToast('Please enter a title or description first', 'warning');
        return;
    }

    const resultDiv = document.getElementById('aiAnalysisResult');
    resultDiv.classList.remove('d-none');
    document.getElementById('aiPriorityBadge').textContent = 'Analyzing…';
    document.getElementById('aiPriorityBadge').className = 'ai-badge bg-secondary text-white';
    document.getElementById('aiConfidenceBadge').textContent = 'Please wait…';
    document.getElementById('aiActionsList').innerHTML = '';
    document.getElementById('aiVerifyText').textContent = '';

    let result;
    try {
        if (geminiReady) {
            result = await analyzeWithGemini(type, title, desc, loc);
        } else {
            console.warn('⚠️ Gemini not ready, using rule-based with local type detection');
            const detected = detectIncidentType(title, desc);
            result = enhancedAIAnalysis(detected.type, desc, loc, title);
            result.detectedType = detected.type;
        }
    } catch (err) {
        console.warn('Gemini call failed:', err);
        if (window.GEMINI_CONFIG && window.GEMINI_CONFIG.ENABLE_FALLBACK) {
            const detected = detectIncidentType(title, desc);
            result = enhancedAIAnalysis(detected.type, desc, loc, title);
            result.detectedType = detected.type;
            result.source = 'rule-based (AI unavailable)';
            showToast('AI busy — using local analysis', 'info', 3000);
        } else {
            showToast('AI analysis failed: ' + err.message, 'danger');
            resultDiv.classList.add('d-none');
            return;
        }
    }

    if (result.detectedType && result.detectedType !== type) {
        typeSelect.value = result.detectedType;
        const hint = document.getElementById('autoTypeHint');
        if (hint) {
            hint.textContent = `✨ Auto-detected: ${result.detectedType}`;
            hint.style.color = 'var(--primary)';
            setTimeout(() => { hint.textContent = ''; }, 8000);
        }
    }

    renderAIAnalysisResult(result);
}

function renderAIAnalysisResult(result) {
    const resultDiv       = document.getElementById('aiAnalysisResult');
    const priorityBadge   = document.getElementById('aiPriorityBadge');
    const confidenceBadge = document.getElementById('aiConfidenceBadge');
    const actionsList     = document.getElementById('aiActionsList');
    const verifyText      = document.getElementById('aiVerifyText');

    const colors = { critical: 'danger', high: 'warning', medium: 'primary', low: 'secondary' };

    priorityBadge.textContent = `Priority: ${result.priority.toUpperCase()}`;
    priorityBadge.className = `ai-badge bg-${colors[result.priority] || 'secondary'} text-white`;
    confidenceBadge.textContent = `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
    actionsList.innerHTML = '<i class="fas fa-tasks me-1"></i> ' + result.actions.join(' · ');
    verifyText.textContent = result.verification;

    let reasoningEl = document.getElementById('aiReasoningList');
    if (!reasoningEl) {
        reasoningEl = document.createElement('div');
        reasoningEl.id = 'aiReasoningList';
        reasoningEl.className = 'mt-1 small text-muted-civic';
        reasoningEl.style.fontStyle = 'italic';
        verifyText.parentElement.parentElement.appendChild(reasoningEl);
    }
    const src = result.source === 'gemini' ? '🤖 Gemini AI' : '⚙️ Local analysis';
    const lang = result.detectedLanguage && result.detectedLanguage !== 'unknown' ? ` [${result.detectedLanguage}]` : '';
    const typeInfo = result.detectedType ? ` • type: ${result.detectedType}` : '';
    reasoningEl.innerHTML = `${src}${lang}${typeInfo}: ` + (result.reasoning || []).join(' • ');

    resultDiv.style.borderLeftColor =
        result.priority === 'critical' ? '#dc3545' :
        result.priority === 'high'     ? '#fd7e14' :
        result.priority === 'medium'   ? '#0d6efd' : '#6c757d';

    window._aiResult = result;

    showToast(
        `AI: ${result.priority.toUpperCase()} (${(result.confidence * 100).toFixed(0)}%)` +
        (result.detectedType ? ` — Type: ${result.detectedType}` : ''),
        result.priority === 'critical' ? 'danger' :
        result.priority === 'high'     ? 'warning' : 'info',
        4000
    );
}

async function analyzeWithGeminiFallback(type, title, desc, loc) {
    if (geminiReady) {
        try {
            return await analyzeWithGemini(type, title, desc, loc);
        } catch (e) {
            console.warn('Gemini failed during submit, using rule-based:', e);
        }
    }
    const detected = detectIncidentType(title, desc);
    const result = enhancedAIAnalysis(detected.type, desc, loc, title);
    result.detectedType = detected.type;
    return result;
}

// ============================================
// PAGE LOADING
// ============================================
function loadPage(page) {
    if (page !== 'dashboard' && barangayMap) {
        try { barangayMap.remove(); } catch (e) {}
        barangayMap = null;
        barangayMarkers = [];
        if (barangayRealtimeChannel) {
            try { supabaseClient.removeChannel(barangayRealtimeChannel); } catch (e) {}
            barangayRealtimeChannel = null;
        }
        if (barangayRealtimeChannel2) {
            try { supabaseClient.removeChannel(barangayRealtimeChannel2); } catch (e) {}
            barangayRealtimeChannel2 = null;
        }
    }

    switch(page) {
        case 'dashboard': loadDashboard(); break;
        case 'report': openReportModal(); break;
        case 'history': loadHistory(); break;
        case 'profile': loadProfile(); break;
        default: loadDashboard();
    }
}

// ============================================
// DASHBOARD
// ============================================
async function loadDashboard() {
    const container = document.getElementById('pageContent');
    try {
        const { data: reports } = await supabaseClient
            .from('incident_reports')
            .select('*')
            .eq('reporter_id', currentUser.id)
            .order('created_at', { ascending: false });
        allReports = reports || [];

        const { data: barangayIncidentsData } = await supabaseClient
            .from('incident_reports')
            .select('*')
            .eq('barangay', currentProfile.barangay)
            .in('status', ['reported', 'acknowledged', 'responding'])
            .order('created_at', { ascending: false });

        const total = reports?.length || 0;
        const active = reports?.filter(r => !['resolved', 'closed'].includes(r.status)).length || 0;
        const resolved = reports?.filter(r => r.status === 'resolved').length || 0;

        const otherActiveIncidents = (barangayIncidentsData || []).filter(i => i.reporter_id !== currentUser.id);

        container.innerHTML = `
            <div class="resident-hero">
                <div class="row g-3 align-items-center">
                    <div class="col-lg-8">
                        <h4><i class="fas fa-hand-sparkles me-2"></i>Welcome, ${escapeHtml(currentProfile.full_name || 'Resident')}!</h4>
                        <p><i class="fas fa-map-marker-alt me-1"></i>Barangay ${escapeHtml(currentProfile.barangay || 'Unknown')}</p>
                    </div>
                    <div class="col-lg-4 text-lg-end">
                        <button class="btn-report" onclick="openReportModal()">
                            <i class="fas fa-exclamation-triangle me-2"></i>Report Emergency
                        </button>
                    </div>
                </div>
            </div>

            <div class="row g-3 mb-4">
                <div class="col-6 col-lg-4">
                    <div class="stat-card-r">
                        <div class="stat-info">
                            <div class="stat-num">${total}</div>
                            <div class="stat-lbl">Total Reports</div>
                        </div>
                        <div class="stat-icon blue"><i class="fas fa-file-alt"></i></div>
                    </div>
                </div>
                <div class="col-6 col-lg-4">
                    <div class="stat-card-r">
                        <div class="stat-info">
                            <div class="stat-num">${active}</div>
                            <div class="stat-lbl">Active</div>
                        </div>
                        <div class="stat-icon yellow"><i class="fas fa-clock"></i></div>
                    </div>
                </div>
                <div class="col-12 col-lg-4">
                    <div class="stat-card-r">
                        <div class="stat-info">
                            <div class="stat-num">${resolved}</div>
                            <div class="stat-lbl">Resolved</div>
                        </div>
                        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
                    </div>
                </div>
            </div>

            <div class="resident-map-card">
                <div class="resident-map-header">
                    <h6><i class="fas fa-map-marked-alt"></i> Live Barangay Map</h6>
                    <span class="text-muted small"><i class="fas fa-circle" style="color:var(--primary);font-size:0.5rem;animation:pulse-dot 1.6s infinite;"></i> Real-time · incl. Facebook reports</span>
                </div>
                <div class="resident-map-body">
                    <div id="barangayMap"></div>
                    <div class="map-legend" id="mapLegend">
                        <span class="map-legend-title">Incident Legend</span>
                        <div class="map-legend-item"><span class="map-legend-marker fire"></span> Fire</div>
                        <div class="map-legend-item"><span class="map-legend-marker medical"></span> Medical</div>
                        <div class="map-legend-item"><span class="map-legend-marker accident"></span> Accident</div>
                        <div class="map-legend-item"><span class="map-legend-marker flood"></span> Flood</div>
                        <div class="map-legend-item"><span class="map-legend-marker crime"></span> Crime</div>
                        <div class="map-legend-item"><span class="map-legend-marker other"></span> Other</div>
                        <div class="map-legend-item" style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border);">
                            <span class="map-legend-marker resolved"></span> Resolved
                        </div>
                    </div>
                    <div class="map-status-bar" id="mapStatusBar">
                        <span class="map-live-dot"></span>Loading…
                    </div>
                </div>
            </div>

            ${otherActiveIncidents.length > 0 ? `
                <div class="alert-banner">
                    <div class="alert-icon"><i class="fas fa-bell"></i></div>
                    <div class="alert-body">
                        <div class="alert-title">${otherActiveIncidents.length} Active Incident${otherActiveIncidents.length > 1 ? 's' : ''} in Your Barangay</div>
                        <p class="alert-text">Stay alert and avoid affected areas. Tap any incident below for details.</p>
                    </div>
                </div>
            ` : ''}

            <div class="section-card">
                <div class="section-card-header">
                    <h6><i class="fas fa-broadcast"></i>Active Incidents in Your Barangay</h6>
                    <span class="badge-count">${otherActiveIncidents.length}</span>
                </div>
                <div>
                    ${otherActiveIncidents.length > 0
                        ? otherActiveIncidents.slice(0, 5).map(inc => renderIncidentRow(inc)).join('')
                        : `<div class="empty-state">
                                <i class="fas fa-shield-halved"></i>
                                <h6>All Clear</h6>
                                <p>No active incidents in your barangay.</p>
                           </div>`
                    }
                </div>
            </div>

            <div class="section-card">
                <div class="section-card-header">
                    <h6><i class="fas fa-history"></i>Your Recent Reports</h6>
                    ${reports && reports.length > 5 ? `<button class="btn-civic btn-outline btn-sm" onclick="loadHistory()">View All</button>` : ''}
                </div>
                <div>
                    ${reports && reports.length > 0
                        ? reports.slice(0, 5).map(r => renderIncidentRow(r, true)).join('')
                        : `<div class="empty-state">
                                <i class="fas fa-file-alt"></i>
                                <h6>No reports yet</h6>
                                <p>You haven't submitted any incident reports.</p>
                                <button class="btn-civic btn-primary btn-sm mt-3" onclick="openReportModal()">
                                    <i class="fas fa-plus"></i>Report Now
                                </button>
                           </div>`
                    }
                </div>
            </div>
        `;

        setTimeout(initBarangayMap, 200);

        if (window.CuliatDesign) {
            window.CuliatDesign.initLucide();
            window.CuliatDesign.initReveal();
        }

    } catch (error) {
        console.error('Dashboard error:', error);
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>Error loading dashboard</div>';
    }
}

// ============================================
// RENDER INCIDENT ROW — with type icon + pulse animation
// ============================================
function renderIncidentRow(incident, isOwnReport) {
    const type = incident.type || 'other';
    const typeIcon = getTypeIcon(type);
    const typeClass = getTypeClass(type);
    const priority = incident.priority || 'medium';
    const status = incident.status || 'reported';
    const shortLoc = getShortLocation(incident.location);
    const fullLoc = escapeHtml(String(incident.location || 'Unknown'));
    const createdShort = incident.created_at
        ? new Date(incident.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—';
    const mediaCount = getMediaUrls(incident).length;

    const pulse = getPriorityPulseClasses(priority);

    return `
        <div class="incident-row priority-${priority} bg-transparent ${pulse.card}"
             onclick="viewResidentIncidentDetail('${incident.id}', 'resident')">
            <div class="inc-icon ${typeClass} ${pulse.icon}">
                <i class="fas ${typeIcon}"></i>
            </div>
            <div class="inc-body">
                <div class="inc-title" title="${escapeHtml(incident.title || 'Untitled')}">
                    ${escapeHtml(incident.title || 'Untitled Incident')}
                </div>
                <div class="inc-meta">
                    <span class="meta-item" title="${fullLoc}">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="loc-text">${escapeHtml(shortLoc)}</span>
                    </span>
                    <span class="meta-item">
                        <i class="fas fa-clock"></i>${createdShort}
                    </span>
                    ${mediaCount > 0 ? `<span class="meta-item"><i class="fas fa-paperclip"></i>${mediaCount}</span>` : ''}
                </div>
            </div>
            <div class="inc-right">
                <span class="badge-priority-sm priority-${priority}">${priority}</span>
                <span class="status-badge status-${status}">${status}</span>
            </div>
            <i class="fas fa-chevron-right inc-arrow"></i>
        </div>
    `;
}

// ============================================
// VIEW RESIDENT INCIDENT DETAIL MODAL
// ============================================
async function viewResidentIncidentDetail(incidentId, source) {
    let incident = null;
    source = source || 'resident';

    try {
        if (source === 'facebook') {
            const { data } = await supabaseClient
                .from('emergencies')
                .select('*')
                .eq('id', incidentId)
                .maybeSingle();
            if (data) incident = data;
        } else {
            const { data } = await supabaseClient
                .from('incident_reports')
                .select('*')
                .eq('id', incidentId)
                .maybeSingle();
            if (data) incident = data;
        }
    } catch (e) { console.warn('Detail fetch failed:', e); }

    if (!incident) {
        incident = allReports.find(r => r.id === incidentId);
    }
    if (!incident) {
        showToast('Incident not found', 'warning');
        return;
    }

    if (!residentDetailModal) {
        residentDetailModal = new bootstrap.Modal(document.getElementById('residentIncidentDetailModal'));
    }

    const type = incident.type || 'other';
    const typeIcon = getTypeIcon(type);
    const priority = incident.priority || 'medium';
    const status = incident.status || 'reported';
    const mediaUrls = getMediaUrls(incident);

    const createdDate = incident.created_at
        ? new Date(incident.created_at).toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : 'Unknown';

    const rawDescription = (incident.description == null) ? '' : String(incident.description).trim();
    const escapedDescription = escapeHtml(rawDescription);
    const fullLocation = escapeHtml(typeof incident.location === 'string'
        ? incident.location
        : JSON.stringify(incident.location || 'Unknown location'));

    const sourceBadge = source === 'facebook'
        ? `<span class="badge" style="background:#0084FF;color:#fff;"><i class="fab fa-facebook-messenger me-1"></i>Facebook Report</span>`
        : `<span class="badge bg-secondary"><i class="fas fa-user me-1"></i>Resident Report</span>`;

    document.getElementById('residentDetailTitle').innerHTML =
        `<i class="fas ${typeIcon}"></i>${escapeHtml(incident.title || 'Incident Details')}`;

    document.getElementById('residentDetailBody').innerHTML = `
        <div class="d-flex gap-2 mb-3 flex-wrap">
            ${sourceBadge}
            <span class="badge-priority-sm priority-${priority}" style="font-size:0.72rem;padding:6px 16px;">
                <i class="fas fa-exclamation-triangle me-1"></i>${priority} priority
            </span>
            <span class="status-badge status-${status}" style="font-size:0.72rem;padding:6px 16px;">
                <i class="fas fa-circle me-1" style="font-size:0.5rem;"></i>${status}
            </span>
        </div>

        <div class="detail-section-title"><i class="fas fa-align-left me-1"></i>Description</div>
        ${rawDescription
            ? `<div class="detail-desc">${escapedDescription}</div>`
            : `<div class="detail-desc" style="opacity:0.7;font-style:italic;">No description provided.</div>`
        }

        <div class="detail-meta-grid">
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-tag me-1"></i>Type</div>
                <div class="val text-capitalize">${escapeHtml(type)}</div>
            </div>
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-map-marker-alt me-1"></i>Location</div>
                <div class="val">${fullLocation}</div>
            </div>
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-clock me-1"></i>Reported</div>
                <div class="val" style="font-size:0.82rem;">${createdDate}</div>
            </div>
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-hashtag me-1"></i>Report ID</div>
                <div class="val" style="font-size:0.78rem;font-family:monospace;">${incident.id.substring(0, 12)}…</div>
            </div>
            ${incident.contact_number || incident.reporter_phone ? `
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-phone me-1"></i>Contact</div>
                <div class="val">${escapeHtml(incident.contact_number || incident.reporter_phone)}</div>
            </div>` : ''}
            ${incident.barangay ? `
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-building me-1"></i>Barangay</div>
                <div class="val">${escapeHtml(incident.barangay)}</div>
            </div>` : ''}
            ${incident.reporter_name ? `
            <div class="detail-meta-item">
                <div class="lbl"><i class="fas fa-user me-1"></i>Reporter</div>
                <div class="val">${escapeHtml(incident.reporter_name)}</div>
            </div>` : ''}
        </div>

        ${mediaUrls.length > 0 ? `
            <div class="detail-section-title"><i class="fas fa-paperclip me-1"></i>Attachments (${mediaUrls.length})</div>
            <div class="detail-media-grid">
                ${mediaUrls.map(m => {
                    const isVideo = m.type === 'video';
                    return `
                        <div class="detail-media-item" onclick="openResidentMedia('${m.url}', '${isVideo ? 'video' : 'image'}')">
                            ${isVideo
                                ? `<video src="${m.url}" muted></video><span class="media-type-tag"><i class="fas fa-video me-1"></i>Video</span>`
                                : `<img src="${m.url}" alt="Attachment" onerror="this.style.opacity=0.3"><span class="media-type-tag"><i class="fas fa-image me-1"></i>Image</span>`
                            }
                        </div>`;
                }).join('')}
            </div>
        ` : ''}

        <div class="detail-section-title" style="margin-top:20px;"><i class="fas fa-stream me-1"></i>Timeline</div>
        <div class="detail-timeline">
            <div class="tl-item">
                <span class="tl-dot active"></span>
                <div class="tl-label">Reported</div>
                <div class="tl-time">${incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Pending'}</div>
            </div>
            <div class="tl-item">
                <span class="tl-dot ${incident.acknowledged_at ? 'active' : ''}"></span>
                <div class="tl-label">Acknowledged</div>
                <div class="tl-time">${incident.acknowledged_at ? new Date(incident.acknowledged_at).toLocaleString() : 'Pending'}</div>
            </div>
            <div class="tl-item">
                <span class="tl-dot ${incident.responded_at ? 'active' : ''}"></span>
                <div class="tl-label">Responding</div>
                <div class="tl-time">${incident.responded_at ? new Date(incident.responded_at).toLocaleString() : 'Pending'}</div>
            </div>
            <div class="tl-item">
                <span class="tl-dot ${incident.resolved_at ? 'active' : ''}"></span>
                <div class="tl-label">Resolved</div>
                <div class="tl-time">${incident.resolved_at ? new Date(incident.resolved_at).toLocaleString() : 'Pending'}</div>
            </div>
        </div>
    `;

    residentDetailModal.show();
}

function openResidentMedia(url, type) {
    let lb = document.getElementById('residentMediaLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'residentMediaLightbox';
        lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;cursor:pointer;';
        lb.innerHTML = '<button style="position:fixed;top:20px;right:24px;background:rgba(0,0,0,0.5);border:none;color:#fff;width:46px;height:46px;border-radius:50%;font-size:1.4rem;cursor:pointer;"><i class="fas fa-times"></i></button><div id="residentMediaContent" style="max-width:95%;max-height:90%;"></div>';
        lb.addEventListener('click', function() { lb.style.display = 'none'; document.getElementById('residentMediaContent').innerHTML = ''; document.body.style.overflow = ''; });
        document.body.appendChild(lb);
    }
    const content = document.getElementById('residentMediaContent');
    if (type === 'video') {
        content.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%;max-height:85vh;border-radius:12px;display:block;"></video>`;
    } else {
        content.innerHTML = `<img src="${url}" style="max-width:100%;max-height:85vh;border-radius:12px;display:block;">`;
    }
    lb.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// ============================================
// HISTORY
// ============================================
async function loadHistory() {
    const container = document.getElementById('pageContent');
    try {
        const { data: reports } = await supabaseClient
            .from('incident_reports')
            .select('*')
            .eq('reporter_id', currentUser.id)
            .order('created_at', { ascending: false });

        container.innerHTML = `
            <div class="section-card">
                <div class="section-card-header">
                    <h6><i class="fas fa-history"></i>Report History</h6>
                    <span class="badge-count">${reports?.length || 0}</span>
                </div>
                <div>
                    ${reports && reports.length > 0
                        ? reports.map(r => renderIncidentRow(r, true)).join('')
                        : `<div class="empty-state">
                                <i class="fas fa-file-alt"></i>
                                <h6>No reports submitted</h6>
                                <p>You haven't submitted any incident reports yet.</p>
                                <button class="btn-civic btn-primary btn-sm mt-3" onclick="openReportModal()">
                                    <i class="fas fa-plus"></i>Report Now
                                </button>
                           </div>`
                    }
                </div>
            </div>
        `;

        if (window.CuliatDesign) window.CuliatDesign.initLucide();
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading history</div>';
    }
}

// ============================================
// PROFILE
// ============================================
function loadProfile() {
    const container = document.getElementById('pageContent');
    if (!currentProfile) {
        container.innerHTML = `<div class="text-center py-5"><div class="spinner-border" role="status" style="color:var(--primary);"><span class="visually-hidden">Loading...</span></div><p class="mt-2 text-muted-civic">Loading profile...</p></div>`;
        refreshProfile(); return;
    }

    container.innerHTML = `
        <div class="section-card">
            <div class="section-card-header">
                <h6><i class="fas fa-user"></i>My Profile</h6>
            </div>
            <div class="p-3 p-md-4">
                <div class="row g-3">
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Full Name</div>
                            <div class="val">${escapeHtml(currentProfile.full_name || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Email</div>
                            <div class="val" style="word-break:break-all;">${escapeHtml(currentUser?.email || currentProfile.email || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Barangay</div>
                            <div class="val">${escapeHtml(currentProfile.barangay || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Contact Number</div>
                            <div class="val">${escapeHtml(currentProfile.contact_number || 'N/A')}</div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Role</div>
                            <div class="val"><span class="badge bg-primary">${escapeHtml(currentProfile.role || 'Resident')}</span></div>
                        </div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="detail-meta-item">
                            <div class="lbl">Member Since</div>
                            <div class="val">${currentProfile.created_at ? new Date(currentProfile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</div>
                        </div>
                    </div>
                </div>
                <hr class="my-4">
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn-civic btn-outline" onclick="refreshProfile()"><i class="fas fa-sync"></i>Refresh Profile</button>
                </div>
            </div>
        </div>
    `;

    if (window.CuliatDesign) window.CuliatDesign.initLucide();
}

async function refreshProfile() {
    try {
        showToast('Refreshing profile...', 'info');
        const { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
        if (error) { showToast('Error refreshing profile', 'danger'); return; }
        if (profile) {
            currentProfile = profile;
            document.getElementById('userNameDisplay').textContent = profile.full_name || 'Resident';
            showToast('Profile refreshed!', 'success');
            loadProfile();
        }
    } catch (error) { showToast('Error refreshing profile', 'danger'); }
}

// ============================================
// REPORT EMERGENCY
// ============================================
function openReportModal() {
    if (!reportModal) { reportModal = new bootstrap.Modal(document.getElementById('reportModal')); }

    document.getElementById('reportForm').reset();
    document.getElementById('aiAnalysisResult').classList.add('d-none');
    document.getElementById('incidentContact').value = currentProfile?.contact_number || '';
    document.getElementById('geocodeSuggestions').classList.remove('show');
    document.getElementById('autoTypeHint').textContent = '';
    window._aiResult = null;

    selectedMediaFiles = [];
    clearMediaPreviews();
    document.getElementById('mediaCount').textContent = '0 / 5';
    document.getElementById('mediaUpload').value = '';

    if (mapInstance && mapMarker) {
        const defaultLat = 14.6760, defaultLng = 121.0150;
        mapInstance.setView([defaultLat, defaultLng], 14);
        mapMarker.setLatLng([defaultLat, defaultLng]);
        updateCoordDisplay(defaultLat, defaultLng);
    }

    reportModal.show();
}

async function submitReport() {
    const type = document.getElementById('incidentType').value;
    const title = document.getElementById('incidentTitle').value.trim();
    const description = document.getElementById('incidentDescription').value.trim();
    const location = document.getElementById('incidentLocation').value.trim();
    const contact = document.getElementById('incidentContact').value.trim();
    const lat = document.getElementById('incidentLat').value;
    const lng = document.getElementById('incidentLng').value;

    if (!title || !description || !location || !contact) { showToast('Please fill in all fields', 'warning'); return; }
    if (!lat || !lng) { showToast('Please select a location on the map or search for a place', 'warning'); return; }

    if (!isInsideBarangay(parseFloat(lat), parseFloat(lng))) {
        showToast('⚠️ Location must be within Barangay Culiat (Tandang Sora, Quezon Ave, Congressional Ave Ext)', 'warning', 7000);
        return;
    }

    let aiResult = window._aiResult;
    if (!aiResult) {
        aiResult = await analyzeWithGeminiFallback(type, title, description, location);
        window._aiResult = aiResult;
    }

    const btn = document.getElementById('submitReportBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

    try {
        const locationObj = { address: location, latitude: parseFloat(lat), longitude: parseFloat(lng) };

        const { data: reportData, error: insertError } = await supabaseClient
            .from('incident_reports')
            .insert([{
                reporter_id: currentUser.id,
                type: type,
                title: title,
                description: description,
                location: JSON.stringify(locationObj),
                contact_number: contact,
                priority: aiResult.priority,
                status: 'reported',
                barangay: currentProfile?.barangay || 'Unknown',
                ai_analysis: {
                    priority: aiResult.priority,
                    confidence: aiResult.confidence,
                    actions: aiResult.actions,
                    verification: aiResult.verification,
                    source: aiResult.source || 'rule-based',
                    reasoning: aiResult.reasoning || [],
                    detectedLanguage: aiResult.detectedLanguage || 'unknown',
                    detectedType: aiResult.detectedType || type
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        let mediaUrls = [];
        if (selectedMediaFiles.length > 0) {
            showToast('📤 Uploading media files...', 'info', 3000);
            mediaUrls = await uploadMediaFiles(reportData.id);

            if (mediaUrls.length > 0) {
                const { error: updateError } = await supabaseClient
                    .from('incident_reports')
                    .update({ media_urls: JSON.stringify(mediaUrls), updated_at: new Date().toISOString() })
                    .eq('id', reportData.id);
                if (updateError) { showToast('Report saved but media upload failed', 'warning'); }
                else { showToast(`✅ ${mediaUrls.length} attachment(s) uploaded!`, 'success'); }
            }
        }

        showToast('✅ Report submitted successfully!', 'success');

        try {
            if (typeof window.sendEmergencyEmailNotification === 'function') {
                const result = await window.sendEmergencyEmailNotification(reportData, false);
                if (result && result.success) {
                    showToast('📧 Email notifications sent to all users!', 'success', 5000);
                }
            }
        } catch (emailError) {
            console.error('Email notification error:', emailError);
        }

        reportModal.hide();
        document.getElementById('reportForm').reset();
        document.getElementById('aiAnalysisResult').classList.add('d-none');
        document.getElementById('geocodeSuggestions').classList.remove('show');
        window._aiResult = null;
        selectedMediaFiles = [];
        clearMediaPreviews();
        document.getElementById('mediaCount').textContent = '0 / 5';
        document.getElementById('mediaUpload').value = '';
        loadDashboard();

    } catch (err) {
        console.error('❌ Submission error:', err);
        showToast('Failed to submit: ' + err.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Submit Report';
    }
}

// ============================================
// REALTIME (personal updates)
// ============================================
function setupRealtime() {
    supabaseClient
        .channel('resident-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports', filter: `reporter_id=eq.${currentUser.id}` }, (payload) => {
            const page = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard';
            if (page === 'dashboard' || page === 'history') { loadPage(page); }
            if (payload.new.status === 'resolved') { showToast('✅ Your report has been resolved!', 'success'); }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports', filter: `barangay=eq.${currentProfile?.barangay || 'Unknown'}` }, (payload) => {
            if (payload.new.reporter_id !== currentUser.id) {
                showToast(`🚨 New incident reported in your barangay: ${payload.new.title}`, 'emergency', 8000);
                const activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard';
                if (activePage === 'dashboard') loadDashboard();
            }
        })
        .subscribe();
}

// ============================================
// TOAST & LOGOUT
// ============================================
function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;
    const container = document.getElementById('toastContainer') || createToastContainer();
    const colors = {
        success: 'bg-success text-white',
        danger: 'bg-danger text-white',
        warning: 'bg-warning text-dark',
        info: 'bg-info text-white',
        emergency: 'bg-danger text-white'
    };
    const icons = {
        success: 'check-circle',
        danger: 'times-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle',
        emergency: 'exclamation-triangle'
    };
    const toast = document.createElement('div');
    toast.className = `toast align-items-center ${colors[type] || colors.info} border-0`;
    toast.role = 'alert';
    toast.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="fas fa-${icons[type] || icons.info} me-2"></i>${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: duration });
    bsToast.show();
    setTimeout(() => toast.remove(), duration + 500);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
    return container;
}

async function logout() {
    try {
        if (barangayMap) { try { barangayMap.remove(); } catch(e) {} }
        if (barangayRealtimeChannel) { try { await supabaseClient.removeChannel(barangayRealtimeChannel); } catch(e) {} }
        if (barangayRealtimeChannel2) { try { await supabaseClient.removeChannel(barangayRealtimeChannel2); } catch(e) {} }
        if (window.CuliatAuthSecurity) {
            window.CuliatAuthSecurity.stopInactivityWatch();
            window.CuliatAuthSecurity.clearOtpVerification();
        }
        await supabaseClient.auth.signOut();
        window.location.href = '../index.html';
    } catch (error) {
        if (window.CuliatAuthSecurity) {
            window.CuliatAuthSecurity.clearOtpVerification();
        }
        window.location.href = '../index.html';
    }
}

// ============================================
// EXPOSE GLOBALLY
// ============================================
window.openReportModal = openReportModal;
window.submitReport = submitReport;
window.analyzeWithAI = analyzeWithAI;
window.logout = logout;
window.refreshProfile = refreshProfile;
window.loadDashboard = loadDashboard;
window.loadHistory = loadHistory;
window.loadProfile = loadProfile;
window.loadPage = loadPage;
window.removeMediaFile = removeMediaFile;
window.viewResidentIncidentDetail = viewResidentIncidentDetail;
window.openResidentMedia = openResidentMedia;
window.initGemini = initGemini;
window.analyzeWithGemini = analyzeWithGemini;
window.analyzeWithGeminiFallback = analyzeWithGeminiFallback;
window.enhancedAIAnalysis = enhancedAIAnalysis;
window.detectIncidentType = detectIncidentType;

document.addEventListener('DOMContentLoaded', initResidentDashboard);
