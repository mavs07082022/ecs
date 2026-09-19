/* ============================================================
   Culiat Public Safety — Landing Page Map
   PUBLIC — Only ACTIVE incidents. NO reporter info exposed.
   Shows: type, priority, status, location, timestamp, source.
   ============================================================ */

(function () {
    'use strict';

    // ============================================
    // CONFIG
    // ============================================
    const BARANGAY_SCOPE = {
        centerLat: 14.6760,
        centerLng: 121.0150,
        bounds: { north: 14.7000, south: 14.6400, east: 121.0400, west: 120.9700 },
        polygon: [
            [14.6990, 121.0150], [14.7020, 121.0280], [14.6980, 121.0380], [14.6880, 121.0420],
            [14.6750, 121.0400], [14.6650, 121.0330], [14.6580, 121.0250], [14.6550, 121.0150],
            [14.6580, 121.0050], [14.6680, 120.9980], [14.6780, 120.9930], [14.6880, 120.9900],
            [14.6960, 120.9950], [14.6990, 121.0050], [14.6990, 121.0150]
        ]
    };

    // Only these statuses are shown on the public map
    const ACTIVE_STATUSES = ['reported', 'acknowledged', 'responding', 'pending', 'verifying', 'verified', 'assigned'];

    // Public-safe tables (created via SQL)
    const INCIDENT_SOURCE = 'incidents_public_view';
    const EMERGENCY_SOURCE = 'emergencies_public_view';

    let map = null;
    let markers = [];
    let allIncidents = [];
    let realtime1 = null;
    let realtime2 = null;
    const geocodeCache = new Map();

    // ============================================
    // INIT
    // ============================================
    document.addEventListener('DOMContentLoaded', function () {
        const mapEl = document.getElementById('landingMap');
        if (!mapEl) return;

        let tries = 0;
        const waitForSupabase = setInterval(function () {
            tries++;
            if (window.supabaseClient) {
                clearInterval(waitForSupabase);
                initLandingMap();
            } else if (tries > 50) {
                clearInterval(waitForSupabase);
                console.warn('⚠️ Landing map: supabaseClient never loaded');
                showMapFallback();
            }
        }, 100);
    });

    function initLandingMap() {
        const mapEl = document.getElementById('landingMap');
        if (!mapEl || map) return;

        map = L.map('landingMap', {
            zoomControl: true,
            attributionControl: false
        }).setView([BARANGAY_SCOPE.centerLat, BARANGAY_SCOPE.centerLng], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19
        }).addTo(map);

        const boundary = L.polygon(BARANGAY_SCOPE.polygon, {
            color: '#2e7d32',
            weight: 2.5,
            opacity: 0.85,
            fillColor: '#2e7d32',
            fillOpacity: 0.06,
            dashArray: '10 5'
        }).addTo(map);

        map.fitBounds(boundary.getBounds(), { padding: [20, 20] });

        loadLandingIncidents();
        setupLandingRealtime();
    }

    function showMapFallback() {
        const mapEl = document.getElementById('landingMap');
        if (!mapEl) return;
        mapEl.innerHTML = `
            <div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);text-align:center;padding:2rem;">
                <div>
                    <i class="fas fa-map-marked-alt" style="font-size:2.5rem;opacity:0.4;margin-bottom:0.75rem;display:block;"></i>
                    <div style="font-weight:700;">Map temporarily unavailable</div>
                    <div style="font-size:0.85rem;margin-top:0.5rem;">Please refresh the page.</div>
                </div>
            </div>
        `;
    }

    // ============================================
    // LOAD — public views, only active, no reporter info
    // ============================================
    async function loadLandingIncidents() {
        if (!map) return;

        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const sinceIso = thirtyDaysAgo.toISOString();

            const [incidentRes, emergencyRes] = await Promise.all([
                supabaseClient
                    .from(INCIDENT_SOURCE)
                    .select('id, type, title, priority, status, location, created_at')
                    .gte('created_at', sinceIso)
                    .in('status', ACTIVE_STATUSES)
                    .order('created_at', { ascending: false })
                    .limit(100),
                supabaseClient
                    .from(EMERGENCY_SOURCE)
                    .select('id, type, title, priority, status, location, created_at')
                    .gte('created_at', sinceIso)
                    .in('status', ACTIVE_STATUSES)
                    .order('created_at', { ascending: false })
                    .limit(100)
            ]);

            const fromResidents = (incidentRes.data || []).map(r => normalizeRow(r, 'resident'));
            const fromFacebook = (emergencyRes.data || []).map(r => normalizeRow(r, 'facebook'));

            const combined = [...fromResidents, ...fromFacebook];
            const seen = new Set();
            const deduped = [];
            for (const inc of combined) {
                const key = `${inc.type}|${inc.title}|${inc.created_at}`;
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(inc);
            }

            deduped.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            allIncidents = deduped;

            renderMarkers(allIncidents);
            await geocodeMissing();
            renderMarkers(allIncidents);
            updateStatusBar(allIncidents);
        } catch (err) {
            console.warn('Landing map load error:', err);
            updateStatusBar([]);
        }
    }

    function normalizeRow(row, source) {
        let coords = extractCoords(row.location);
        if (!coords && row.latitude != null && row.longitude != null) {
            coords = { lat: parseFloat(row.latitude), lng: parseFloat(row.longitude) };
        }
        if (!coords && row.lat != null && row.lng != null) {
            coords = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
        }
        // Public map: NO reporter_name, NO contact_number, NO description
        return {
            id: row.id,
            type: row.type || 'other',
            title: row.title || 'Untitled Incident',
            priority: row.priority || 'medium',
            status: row.status || 'reported',
            location: row.location,
            created_at: row.created_at,
            source: source,
            _lat: coords ? coords.lat : null,
            _lng: coords ? coords.lng : null
        };
    }

    function extractCoords(location) {
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
            if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
        return null;
    }

    // ============================================
    // GEOCODING
    // ============================================
    async function geocodeAddress(locationInput) {
        let address = '';
        if (typeof locationInput === 'string') {
            address = locationInput;
            if (address.trim().startsWith('{')) {
                try {
                    const obj = JSON.parse(address);
                    address = obj.address || obj.location || address;
                } catch (e) {}
            }
        } else if (typeof locationInput === 'object' && locationInput) {
            address = locationInput.address || '';
        }
        address = String(address).trim();
        if (address.length < 3) return null;
        if (geocodeCache.has(address)) return geocodeCache.get(address);

        const coordMatch = address.match(/^(-?\d+\.\d+),?\s*(-?\d+\.\d+)$/);
        if (coordMatch) {
            const r = { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) };
            geocodeCache.set(address, r);
            return r;
        }

        try {
            const viewbox = `${BARANGAY_SCOPE.bounds.west},${BARANGAY_SCOPE.bounds.north},${BARANGAY_SCOPE.bounds.east},${BARANGAY_SCOPE.bounds.south}`;
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ph&viewbox=${viewbox}&bounded=1`;
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' }
            });
            const data = await res.json();
            if (data && data.length > 0) {
                const r = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                geocodeCache.set(address, r);
                return r;
            }
        } catch (e) {}

        geocodeCache.set(address, null);
        return null;
    }

    async function geocodeMissing() {
        const needs = allIncidents.filter(i => i._lat == null || i._lng == null);
        if (needs.length === 0) return;
        console.log(`Landing map: geocoding ${needs.length} active incidents...`);
        for (const inc of needs) {
            const c = await geocodeAddress(inc.location);
            if (c) {
                inc._lat = c.lat;
                inc._lng = c.lng;
            } else {
                inc._lat = BARANGAY_SCOPE.centerLat;
                inc._lng = BARANGAY_SCOPE.centerLng;
                inc._geocodeFallback = true;
            }
            await new Promise(r => setTimeout(r, 1100));
        }
    }

    // ============================================
    // HELPERS
    // ============================================
    function getTypeIcon(type) {
        const m = {
            fire: 'fa-fire', medical: 'fa-heart-pulse', accident: 'fa-car-burst',
            flood: 'fa-water', crime: 'fa-shield-halved', armed_conflict: 'fa-shield-halved',
            natural_disaster: 'fa-water', other: 'fa-circle-exclamation'
        };
        return m[type] || 'fa-circle-exclamation';
    }
    function getTypeClass(type) {
        const m = {
            fire: 'fire', medical: 'medical', accident: 'accident',
            flood: 'flood', crime: 'crime', armed_conflict: 'crime',
            natural_disaster: 'flood', other: 'other'
        };
        return m[type] || 'other';
    }
    function getTypeColor(type) {
        const m = {
            fire: '#dc3545', medical: '#0d6efd', accident: '#fd7e14',
            flood: '#0dcaf0', crime: '#8b5cf6', armed_conflict: '#8b5cf6',
            natural_disaster: '#0dcaf0', other: '#6c757d'
        };
        return m[type] || m.other;
    }
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function getShortLocation(location) {
        if (!location) return 'Unknown location';
        let text = String(location);
        if (text.trim().startsWith('{')) {
            try {
                const obj = JSON.parse(text);
                if (obj && obj.address) text = String(obj.address);
            } catch (e) {}
        }
        const parts = text.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length > 2) return parts.slice(0, 2).join(', ');
        return text;
    }

    // ============================================
    // RENDER
    // ============================================
    function renderMarkers(incidents) {
        if (!map) return;
        markers.forEach(m => { try { map.removeLayer(m); } catch (e) {} });
        markers = [];

        incidents.forEach(inc => {
            if (inc._lat == null || inc._lng == null) return;

            const type = inc.type || 'other';
            const typeIcon = getTypeIcon(type);
            const typeClass = getTypeClass(type);
            const priority = inc.priority || 'medium';
            const status = inc.status || 'reported';
            const isFB = inc.source === 'facebook';

            const badgeHTML = isFB
                ? `<span style="position:absolute;top:-4px;right:-4px;background:#0084FF;color:#fff;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;border:1.5px solid #fff;font-weight:900;z-index:5;">f</span>`
                : '';

            const iconHtml = `
                <div class="landing-marker-pin ${typeClass}" style="position:relative;">
                    <i class="fas ${typeIcon}"></i>
                    ${badgeHTML}
                </div>
            `;

            const customIcon = L.divIcon({
                html: iconHtml,
                className: 'landing-custom-marker',
                iconSize: [28, 28],
                iconAnchor: [14, 28],
                popupAnchor: [0, -28]
            });

            const marker = L.marker([inc._lat, inc._lng], { icon: customIcon }).addTo(map);

            const createdDate = inc.created_at
                ? new Date(inc.created_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })
                : 'Unknown';

            const sourceBadge = isFB
                ? `<span style="background:#0084FF;color:#fff;font-size:0.6rem;padding:2px 8px;border-radius:9999px;font-weight:800;display:inline-flex;align-items:center;gap:3px;"><i class="fab fa-facebook-messenger"></i>FB</span>`
                : `<span style="background:var(--muted);color:var(--muted-foreground);font-size:0.6rem;padding:2px 8px;border-radius:9999px;font-weight:800;">Resident</span>`;

            // PUBLIC POPUP — no reporter name, no contact, no description
            const popupHtml = `
                <div style="font-family:'Manrope',sans-serif;min-width:210px;">
                    <div style="font-family:'Sora',sans-serif;font-weight:800;font-size:0.88rem;margin:0 0 0.5rem;display:flex;align-items:center;gap:0.4rem;">
                        <i class="fas ${typeIcon}" style="color:${getTypeColor(type)};"></i>
                        ${escapeHtml(inc.title)}
                    </div>
                    <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:0.6rem;">
                        ${sourceBadge}
                        <span class="badge priority-${priority}" style="font-size:0.62rem;padding:3px 10px;border-radius:50px;text-transform:uppercase;">${priority}</span>
                        <span class="status-badge status-${status}" style="font-size:0.62rem;padding:3px 10px;">${status}</span>
                    </div>
                    <div style="font-size:0.72rem;color:var(--muted-foreground);display:flex;flex-direction:column;gap:0.35rem;">
                        <span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(getShortLocation(inc.location))}</span>
                        <span><i class="fas fa-clock"></i> ${createdDate}</span>
                    </div>
                    <div style="margin-top:0.65rem;padding-top:0.6rem;border-top:1px dashed var(--border);font-size:0.65rem;color:var(--muted-foreground);font-style:italic;text-align:center;">
                        Reporter information is kept private.
                    </div>
                </div>
            `;

            marker.bindPopup(popupHtml, { maxWidth: 280, minWidth: 210 });
            markers.push(marker);
        });
    }

    function updateStatusBar(incidents) {
        const bar = document.getElementById('landingMapStatusBar');
        if (!bar) return;

        const active = incidents.length; // Already filtered to active only
        const critical = incidents.filter(i => i.priority === 'critical').length;
        const fb = incidents.filter(i => i.source === 'facebook').length;

        let text = active === 0
            ? '✅ All clear in Barangay Culiat'
            : active + ' active incident' + (active > 1 ? 's' : '');
        if (critical > 0) {
            text = '🚨 ' + critical + ' CRITICAL incident' + (critical > 1 ? 's' : '') + ' · ' + active + ' total';
        } else if (fb > 0) {
            text += ' · 📘 ' + fb + ' from Facebook';
        }
        bar.innerHTML = '<span class="landing-map-live-dot"></span>' + escapeHtml(text);
    }

    // ============================================
    // REALTIME
    // ============================================
    function setupLandingRealtime() {
        if (realtime1) { try { supabaseClient.removeChannel(realtime1); } catch (e) {} }
        if (realtime2) { try { supabaseClient.removeChannel(realtime2); } catch (e) {} }

        realtime1 = supabaseClient
            .channel('landing-map-residents')
            .on('postgres_changes', { event: '*', schema: 'public', table: INCIDENT_SOURCE }, function (payload) {
                handleRealtimeUpdate(payload, 'resident');
            })
            .subscribe();

        realtime2 = supabaseClient
            .channel('landing-map-facebook')
            .on('postgres_changes', { event: '*', schema: 'public', table: EMERGENCY_SOURCE }, function (payload) {
                handleRealtimeUpdate(payload, 'facebook');
            })
            .subscribe();
    }

    async function handleRealtimeUpdate(payload, source) {
        const eventType = payload.eventType;
        const row = payload.new || payload.old;
        if (!row || !row.id) return;

        // REMOVE: if status changed to non-active, or deleted
        if (eventType === 'DELETE') {
            const idx = allIncidents.findIndex(i => i.id === row.id);
            if (idx >= 0) {
                allIncidents.splice(idx, 1);
                renderMarkers(allIncidents);
                updateStatusBar(allIncidents);
            }
            return;
        }

        // UPDATE — if status is no longer active, remove it
        if (eventType === 'UPDATE') {
            const isStillActive = ACTIVE_STATUSES.includes(row.status);
            const existingIdx = allIncidents.findIndex(i => i.id === row.id);

            if (!isStillActive) {
                // Remove from map (it's been resolved/closed/etc.)
                if (existingIdx >= 0) {
                    allIncidents.splice(existingIdx, 1);
                    renderMarkers(allIncidents);
                    updateStatusBar(allIncidents);
                }
                return;
            }

            // Still active — update in place
            if (existingIdx >= 0) {
                const updated = normalizeRow(row, source);
                if (updated._lat == null) {
                    updated._lat = allIncidents[existingIdx]._lat;
                    updated._lng = allIncidents[existingIdx]._lng;
                }
                allIncidents[existingIdx] = updated;
                renderMarkers(allIncidents);
                updateStatusBar(allIncidents);
            } else {
                // Not in list but now active — add it
                handleNewIncident(row, source);
            }
            return;
        }

        // INSERT
        if (eventType === 'INSERT') {
            if (!ACTIVE_STATUSES.includes(row.status)) return;
            handleNewIncident(row, source);
        }
    }

    async function handleNewIncident(row, source) {
        const inc = normalizeRow(row, source);
        if (inc._lat == null || inc._lng == null) {
            const c = await geocodeAddress(inc.location);
            if (c) {
                inc._lat = c.lat;
                inc._lng = c.lng;
            } else {
                inc._lat = BARANGAY_SCOPE.centerLat;
                inc._lng = BARANGAY_SCOPE.centerLng;
                inc._geocodeFallback = true;
            }
        }
        if (allIncidents.find(i => i.id === inc.id)) return;
        allIncidents.unshift(inc);
        renderMarkers(allIncidents);
        updateStatusBar(allIncidents);
    }

})();