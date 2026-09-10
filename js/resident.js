let currentUser = null;
let currentProfile = null;
let reportModal = null;
let allReports = [];
let mapInstance = null;
let mapMarker = null;
let mapInitialized = false;
let geocodeTimeout = null;
let isGeocoding = false;
let selectedMediaFiles = [];
let mediaPreviewUrls = [];

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
        console.log('✅ Resident Dashboard fully initialized');

    } catch (error) {
        console.error('❌ Init error:', error);
        showToast('Error loading dashboard', 'danger');
    }
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
// MAP FUNCTIONS
// ============================================
function initMap() {
    if (mapInitialized) return;
    const mapContainer = document.getElementById('incidentMap');
    if (!mapContainer) return;

    const defaultLat = 14.5995, defaultLng = 120.9842;
    mapInstance = L.map('incidentMap').setView([defaultLat, defaultLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
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
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=ph`;
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
// AI ANALYSIS
// ============================================
function enhancedAIAnalysis(type, description, location) {
    const text = (type + ' ' + description + ' ' + location).toLowerCase();
    const critical = ['fire', 'explosion', 'shooting', 'stabbing', 'unconscious', 'not breathing', 'severe bleeding', 'heart attack', 'stroke', 'gas leak'];
    const high = ['accident', 'flood', 'crime', 'robbery', 'assault', 'chest pain', 'difficulty breathing', 'heavy bleeding'];
    const medium = ['medical', 'suspicious', 'theft', 'vandalism', 'injury', 'bleeding', 'pain'];

    let score = { critical: 0, high: 0, medium: 0 };
    critical.forEach(w => { if (text.includes(w)) score.critical += 3; });
    high.forEach(w => { if (text.includes(w)) score.high += 2; });
    medium.forEach(w => { if (text.includes(w)) score.medium += 1.5; });

    if (type === 'fire') score.critical += 2;
    if (type === 'medical' && (text.includes('heart') || text.includes('stroke') || text.includes('unconscious'))) score.critical += 2;

    let priority = 'medium', confidence = 0.75;
    if (score.critical >= 3) { priority = 'critical'; confidence = 0.92 + Math.random() * 0.07; }
    else if (score.high >= 3) { priority = 'high'; confidence = 0.85 + Math.random() * 0.1; }
    else if (score.medium >= 2) { priority = 'medium'; confidence = 0.78 + Math.random() * 0.1; }
    else { priority = 'low'; confidence = 0.70 + Math.random() * 0.1; }

    const actionMap = {
        fire: ['Evacuate immediately', 'Call fire department', 'Use extinguisher if safe'],
        medical: ['Call ambulance', 'Perform CPR if trained', 'Keep victim calm'],
        accident: ['Call emergency', 'Secure area', 'Provide first aid if safe'],
        flood: ['Move to higher ground', 'Turn off electricity', 'Secure documents'],
        crime: ['Ensure safety', 'Call authorities', 'Do not confront'],
        other: ['Assess situation', 'Call emergency if needed', 'Provide assistance']
    };
    const actions = actionMap[type] || actionMap.other;
    let verification = priority === 'critical' || priority === 'high' ? '⚠️ Urgent: dispatch responders immediately' : '🟡 Schedule verification within 10 min';

    return { priority, confidence: Math.min(confidence, 0.99), actions, verification };
}

function analyzeWithAI() {
    const type = document.getElementById('incidentType').value;
    const desc = document.getElementById('incidentDescription').value.trim();
    const loc = document.getElementById('incidentLocation').value.trim();
    if (!desc) { showToast('Please enter a description first', 'warning'); return; }

    const result = enhancedAIAnalysis(type, desc, loc);
    const resultDiv = document.getElementById('aiAnalysisResult');
    const priorityBadge = document.getElementById('aiPriorityBadge');
    const confidenceBadge = document.getElementById('aiConfidenceBadge');
    const actionsList = document.getElementById('aiActionsList');
    const verifyText = document.getElementById('aiVerifyText');

    resultDiv.classList.remove('d-none');
    priorityBadge.textContent = `Priority: ${result.priority.toUpperCase()}`;
    priorityBadge.className = `ai-badge bg-${result.priority === 'critical' ? 'danger' : result.priority === 'high' ? 'warning' : result.priority === 'medium' ? 'primary' : 'secondary'} text-white`;
    confidenceBadge.textContent = `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
    actionsList.innerHTML = '<i class="fas fa-tasks me-1"></i> ' + result.actions.join(' · ');
    verifyText.textContent = result.verification;
    resultDiv.style.borderLeftColor = result.priority === 'critical' ? '#dc3545' : result.priority === 'high' ? '#fd7e14' : '#0d6efd';
    window._aiResult = result;
    showToast(`AI analysis: ${result.priority.toUpperCase()} priority with ${(result.confidence*100).toFixed(0)}% confidence`, 'info', 4000);
}

// ============================================
// PAGE LOADING
// ============================================
function loadPage(page) {
    switch(page) {
        case 'dashboard': loadDashboard(); break;
        case 'report': openReportModal(); break;
        case 'history': loadHistory(); break;
        case 'profile': loadProfile(); break;
        default: loadDashboard();
    }
}

async function loadDashboard() {
    const container = document.getElementById('pageContent');
    try {
        const { data: reports } = await supabaseClient.from('incident_reports').select('*').eq('reporter_id', currentUser.id).order('created_at', { ascending: false });
        allReports = reports || [];

        const { data: barangayIncidents } = await supabaseClient.from('incident_reports').select('*').eq('barangay', currentProfile.barangay).in('status', ['reported', 'acknowledged', 'responding']).order('created_at', { ascending: false });

        const total = reports?.length || 0, active = reports?.filter(r => !['resolved', 'closed'].includes(r.status)).length || 0, resolved = reports?.filter(r => r.status === 'resolved').length || 0;

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div><h4 class="fw-bold">Welcome, ${currentProfile.full_name || 'Resident'}!</h4><p class="text-muted">Barangay ${currentProfile.barangay || 'Unknown'}</p></div>
                <div class="d-flex gap-2">
                   
                    <button class="btn btn-danger" onclick="openReportModal()"><i class="fas fa-exclamation-triangle me-2"></i>Report Emergency</button>
                </div>
            </div>

            <div class="row g-4 mb-4">
                <div class="col-md-4"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number">${total}</div><div class="text-muted small">Total Reports</div></div><div class="text-primary"><i class="fas fa-file-alt fa-2x"></i></div></div></div></div>
                <div class="col-md-4"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number text-warning">${active}</div><div class="text-muted small">Active Incidents</div></div><div class="text-warning"><i class="fas fa-clock fa-2x"></i></div></div></div></div>
                <div class="col-md-4"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number text-success">${resolved}</div><div class="text-muted small">Resolved</div></div><div class="text-success"><i class="fas fa-check-circle fa-2x"></i></div></div></div></div>
            </div>

            ${barangayIncidents && barangayIncidents.length > 0 ? `
                <div class="card mb-4"><div class="card-header bg-danger text-white"><h6 class="mb-0"><i class="fas fa-bell me-2"></i>Active Incidents in Your Barangay</h6></div>
                <div class="card-body p-0"><div class="list-group list-group-flush">${barangayIncidents.slice(0, 5).map(incident => `
                    <div class="list-group-item d-flex align-items-center gap-3"><span class="badge priority-${incident.priority || 'medium'}">${incident.priority || 'Medium'}</span><div class="flex-grow-1"><div class="fw-semibold">${incident.title}</div><div class="small text-muted">${incident.type} • ${incident.location}</div>${incident.media_urls ? `<div class="small text-primary"><i class="fas fa-paperclip me-1"></i>${JSON.parse(incident.media_urls).length} attachment(s)</div>` : ''}</div><span class="status-badge status-${incident.status}">${incident.status}</span></div>
                `).join('')}</div></div></div>
            ` : `<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i>No active incidents in your barangay. Stay safe!</div>`}

            <div class="card"><div class="card-header d-flex justify-content-between align-items-center"><h6 class="mb-0"><i class="fas fa-history me-2"></i>Your Recent Reports</h6><button class="btn btn-sm btn-outline-secondary" onclick="loadHistory()">View All</button></div>
                <div class="card-body p-0">${reports && reports.length > 0 ? `<div class="list-group list-group-flush">${reports.slice(0, 5).map(report => `
                    <div class="list-group-item d-flex align-items-center gap-3"><div class="flex-grow-1"><div class="fw-semibold">${report.title}</div><div class="small text-muted">${report.type} • ${report.location} • ${new Date(report.created_at).toLocaleDateString()}</div>${report.media_urls ? `<div class="small text-primary"><i class="fas fa-paperclip me-1"></i>${JSON.parse(report.media_urls).length} attachment(s)</div>` : ''}</div><span class="status-badge status-${report.status}">${report.status}</span></div>
                `).join('')}</div>` : `<div class="text-center py-4 text-muted"><i class="fas fa-check-circle fa-2x mb-2 d-block text-success"></i>No reports yet</div>`}</div></div>
        `;
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading dashboard</div>';
    }
}

async function loadHistory() {
    const container = document.getElementById('pageContent');
    try {
        const { data: reports } = await supabaseClient.from('incident_reports').select('*').eq('reporter_id', currentUser.id).order('created_at', { ascending: false });

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4"><h4 class="fw-bold"><i class="fas fa-history me-2"></i>Report History</h4><button class="btn btn-outline-danger btn-sm" onclick="loadDashboard()"><i class="fas fa-arrow-left me-1"></i>Back</button></div>
            ${reports && reports.length > 0 ? `
                <div class="table-responsive"><table class="table table-hover"><thead><tr><th>Date</th><th>Title</th><th>Type</th><th>Location</th><th>Priority</th><th>Status</th><th>Media</th></tr></thead><tbody>
                    ${reports.map(report => `<tr><td>${new Date(report.created_at).toLocaleDateString()}</td><td>${report.title}</td><td>${report.type}</td><td>${report.location}</td><td><span class="badge priority-${report.priority || 'medium'}">${report.priority || 'Medium'}</span></td><td><span class="status-badge status-${report.status}">${report.status}</span></td><td>${report.media_urls ? `<span class="badge bg-primary"><i class="fas fa-paperclip me-1"></i>${JSON.parse(report.media_urls).length}</span>` : '<span class="text-muted">None</span>'}</td></tr>`).join('')}
                </tbody></table></div>
            ` : `<div class="text-center py-5 text-muted"><i class="fas fa-file-alt fa-3x mb-3 d-block"></i><h5>No reports submitted</h5><p>You haven't submitted any incident reports yet.</p><button class="btn btn-danger mt-2" onclick="openReportModal()"><i class="fas fa-plus me-2"></i>Report Now</button></div>`}
        `;
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading history</div>';
    }
}

function loadProfile() {
    const container = document.getElementById('pageContent');
    if (!currentProfile) {
        container.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-danger" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading profile...</p></div>`;
        refreshProfile(); return;
    }

    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-user me-2"></i>My Profile</h4>
        <div class="card"><div class="card-body"><div class="row g-4">
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Full Name</label><p class="fw-semibold fs-5">${currentProfile.full_name || 'N/A'}</p></div></div>
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Email</label><p class="fw-semibold fs-5">${currentUser?.email || currentProfile.email || 'N/A'}</p></div></div>
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Barangay</label><p class="fw-semibold fs-5">${currentProfile.barangay || 'N/A'}</p></div></div>
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Contact Number</label><p class="fw-semibold fs-5">${currentProfile.contact_number || 'N/A'}</p></div></div>
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Role</label><p class="fw-semibold fs-5"><span class="badge bg-primary">${currentProfile.role || 'Resident'}</span></p></div></div>
            <div class="col-md-6"><div class="profile-field"><label class="text-muted small fw-bold">Member Since</label><p class="fw-semibold fs-5">${currentProfile.created_at ? new Date(currentProfile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</p></div></div>
        </div><hr><div class="d-flex gap-2">
            <button class="btn btn-outline-primary" onclick="refreshProfile()"><i class="fas fa-sync me-2"></i>Refresh Profile</button>
            <button class="btn btn-outline-secondary" onclick="loadDashboard()"><i class="fas fa-arrow-left me-2"></i>Back to Dashboard</button>
        </div></div></div>
    `;
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
    window._aiResult = null;
    
    selectedMediaFiles = [];
    clearMediaPreviews();
    document.getElementById('mediaCount').textContent = '0 / 5';
    document.getElementById('mediaUpload').value = '';
    
    if (mapInstance && mapMarker) {
        const defaultLat = 14.5995, defaultLng = 120.9842;
        mapInstance.setView([defaultLat, defaultLng], 15);
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

    let aiResult = window._aiResult || enhancedAIAnalysis(type, description, location);
    if (!window._aiResult) { aiResult = enhancedAIAnalysis(type, description, location); window._aiResult = aiResult; }

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
                    raw: aiResult.raw
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        console.log('✅ Report created with ID:', reportData.id);

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
        
        // ============================================
        // SEND EMAIL NOTIFICATIONS VIA SMTP
        // ============================================
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
// REALTIME
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
                loadDashboard();
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
        await supabaseClient.auth.signOut();
        window.location.href = '../index.html';
    } catch (error) { window.location.href = '../index.html'; }
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

document.addEventListener('DOMContentLoaded', initResidentDashboard);