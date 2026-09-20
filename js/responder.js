/* ============================================================
   Culiat Public Safety — Responder Dashboard (v11)
   - Realtime siren + emergency popup + barangay map
   - Enhanced type icons & pulse animations
   - Send Alert modal = full incident-style form (admin only)
   - Professional stat cards (icon pinned right)
   - Alerts visible to BOTH admin + responders (view-only for responders)
   - Alerts notify residents + responders (in-app notification rows)
   - Alert popup notifications appear on dashboard (like incident reports)
   - Live unread-alerts badge on sidebar bell icon
   - NEW: Responders + admins can VIEW full alert details
   ============================================================ */

let currentUser = null;
let currentProfile = null;
let allIncidents = [];
let actionModal = null;
let addResponderModal = null;
let alertModal = null;
let popupData = null;
let audioContext = null;
let isSirenPlaying = false;
let sirenInterval = null;
let sirenOscillators = [];
let sirenGainNodes = [];
let realtimeChannel = null;
let isInitialized = false;
let pollingInterval = null;
let audioInitialized = false;
let processedIncidentIds = new Set();
let pendingSirenRequest = null;
let isOnIncidentsPage = false;

// Analytics state
let analyticsRange = 30;
let analyticsCharts = {};
let analyticsRefreshTimer = null;

// Popup timer
let popupTimerInterval = null;

// Map state
let responderMap = null;
let responderMarkers = [];
let responderMapData = [];
let responderMapRealtime1 = null;
let responderMapRealtime2 = null;
let responderBoundaryLayer = null;

// Alert modal map state
let alertMap = null;
let alertMapMarker = null;
let alertMapInitialized = false;
let alertGeocodeTimeout = null;
let isAlertGeocoding = false;

// Alert media state
let selectedAlertMediaFiles = [];

// Gemini state
let geminiClient = null;
let geminiModel = null;
let geminiReady = false;
const aiCache = new Map();

// Notifications state
let notificationsRealtimeChannel = null;
let unreadAlertsCount = 0;
let processedNotificationIds = new Set();

// Geocode cache
const geocodeCache = new Map();

// ============================================
// BARANGAY SCOPE
// ============================================
const BARANGAY_SCOPE = {
    name: 'Barangay Culiat',
    bounds: { north: 14.7000, south: 14.6400, east: 121.0400, west: 120.9700 },
    centerLat: 14.6760,
    centerLng: 121.0150,
    polygon: [
        [14.6990, 121.0150], [14.7020, 121.0280], [14.6980, 121.0380],
        [14.6880, 121.0420], [14.6750, 121.0400], [14.6650, 121.0330],
        [14.6580, 121.0250], [14.6550, 121.0150], [14.6580, 121.0050],
        [14.6680, 120.9980], [14.6780, 120.9930], [14.6880, 120.9900],
        [14.6960, 120.9950], [14.6990, 121.0050], [14.6990, 121.0150]
    ]
};

// ============================================
// AUDIO / SIREN
// ============================================
function initAudio() {
    try {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') audioContext.resume();
        if (audioContext.state === 'running') {
            audioInitialized = true;
            if (pendingSirenRequest) { pendingSirenRequest = null; playSirenSound(); }
            return true;
        }
        return false;
    } catch (error) { return false; }
}

function playSirenSound() {
    try {
        stopSirenSound();
        if (!audioInitialized || !audioContext || audioContext.state !== 'running') { pendingSirenRequest = true; return; }
        isSirenPlaying = true;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, audioContext.currentTime);
        gain.gain.setValueAtTime(0.12, audioContext.currentTime);
        sirenOscillators = [osc];
        sirenGainNodes = [gain];
        osc.start(audioContext.currentTime);
        let toggle = false;
        function updateSiren() {
            if (!isSirenPlaying) return;
            try {
                toggle = !toggle;
                osc.frequency.setValueAtTime(toggle ? 850 : 600, audioContext.currentTime);
                sirenInterval = setTimeout(updateSiren, 220);
            } catch (e) { isSirenPlaying = false; }
        }
        sirenInterval = setTimeout(updateSiren, 220);
    } catch (error) { console.warn('Siren error:', error); }
}

function stopSirenSound() {
    isSirenPlaying = false;
    if (sirenInterval) { clearTimeout(sirenInterval); sirenInterval = null; }
    try {
        sirenOscillators.forEach(function(osc) { try { osc.stop(); osc.disconnect(); } catch(e) {} });
        sirenOscillators = [];
        sirenGainNodes = [];
    } catch(e) {}
}

// ============================================
// TOASTS
// ============================================
function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;
    var container = document.getElementById('toastContainer') || createToastContainer();
    var colors = {
        success: 'bg-success text-white', danger: 'bg-danger text-white',
        warning: 'bg-warning text-dark', info: 'bg-info text-white', emergency: 'bg-danger text-white'
    };
    var icons = {
        success: 'check-circle', danger: 'times-circle', warning: 'exclamation-triangle',
        info: 'info-circle', emergency: 'exclamation-triangle'
    };
    var toast = document.createElement('div');
    toast.className = 'toast align-items-center ' + (colors[type] || colors.info) + ' border-0';
    toast.role = 'alert';
    toast.innerHTML = '<div class="d-flex"><div class="toast-body"><i class="fas fa-' + (icons[type] || icons.info) + ' me-2"></i>' + message + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    container.appendChild(toast);
    var bsToast = new bootstrap.Toast(toast, { autohide: true, delay: duration });
    bsToast.show();
    setTimeout(function() { toast.remove(); }, duration + 500);
}

function createToastContainer() {
    var container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
    return container;
}

// ============================================
// HELPERS
// ============================================
function getMediaUrls(incident) {
    if (!incident) return [];
    if (incident.media_urls) {
        try {
            var urls = typeof incident.media_urls === 'string' ? JSON.parse(incident.media_urls) : incident.media_urls;
            if (Array.isArray(urls) && urls.length > 0) return urls;
        } catch (e) {}
    }
    if (incident.images) {
        try {
            var urls = typeof incident.images === 'string' ? JSON.parse(incident.images) : incident.images;
            if (Array.isArray(urls) && urls.length > 0) return urls;
        } catch (e) {}
    }
    return [];
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatLocationForPopup(location) {
    if (!location) return 'Unknown location';
    var text = String(location);
    if (text.trim().startsWith('{')) {
        try { var obj = JSON.parse(text); if (obj && obj.address) return String(obj.address); } catch (e) {}
    }
    return text;
}

function getShortLocation(location) {
    if (!location) return 'Unknown location';
    var text = String(location);
    if (text.trim().startsWith('{')) {
        try { var obj = JSON.parse(text); if (obj && obj.address) text = String(obj.address); } catch (e) {}
    }
    var parts = text.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (parts.length > 2) return parts.slice(0, 2).join(', ');
    return text;
}

function timeAgo(dateStr) {
    if (!dateStr) return 'just now';
    var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return '—'; }
}

function getTypeIcon(type) {
    var map = {
        fire: 'fa-fire', medical: 'fa-heart-pulse', accident: 'fa-car-burst',
        flood: 'fa-water', crime: 'fa-shield-halved', armed_conflict: 'fa-shield-halved',
        natural_disaster: 'fa-water', other: 'fa-circle-exclamation'
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
        fire: '#dc3545', medical: '#0d6efd', accident: '#fd7e14',
        flood: '#0dcaf0', crime: '#8b5cf6', armed_conflict: '#8b5cf6',
        natural_disaster: '#0dcaf0', other: '#6c757d'
    };
    return map[type] || map.other;
}

function getPriorityPulseClasses(priority) {
    if (priority === 'critical') return { card: 'pulse-critical', icon: 'pulse-icon-critical' };
    if (priority === 'high') return { card: 'pulse-high', icon: '' };
    return { card: '', icon: '' };
}

// ============================================
// GEOCODING
// ============================================
async function geocodeLocationString(locationInput) {
    let address = '';
    if (typeof locationInput === 'string') {
        address = locationInput;
        if (address.trim().startsWith('{')) {
            try { const obj = JSON.parse(address); address = obj.address || obj.location || address; } catch (e) {}
        }
    } else if (typeof locationInput === 'object' && locationInput) {
        address = locationInput.address || '';
    }
    address = String(address).trim();
    if (address.length < 3) return null;
    if (geocodeCache.has(address)) return geocodeCache.get(address);
    const coordMatch = address.match(/^(-?\d+\.\d+),?\s*(-?\d+\.\d+)$/);
    if (coordMatch) {
        const result = { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) };
        geocodeCache.set(address, result);
        return result;
    }
    try {
        const viewbox = `${BARANGAY_SCOPE.bounds.west},${BARANGAY_SCOPE.bounds.north},${BARANGAY_SCOPE.bounds.east},${BARANGAY_SCOPE.bounds.south}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ph&viewbox=${viewbox}&bounded=1`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' } });
        const data = await res.json();
        if (data && data.length > 0) {
            const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            geocodeCache.set(address, result);
            return result;
        }
    } catch (e) { console.warn('Geocode failed:', e.message); }
    geocodeCache.set(address, null);
    return null;
}

// ============================================
// POPUP MEDIA
// ============================================
function renderPopupMedia(mediaUrls) {
    var container = document.getElementById('popupMediaContainer');
    var list = document.getElementById('popupMediaList');
    if (!container || !list) return;
    if (!mediaUrls || mediaUrls.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    list.innerHTML = '';
    mediaUrls.forEach(function(media) {
        var item = document.createElement('div');
        item.className = 'popup-media-item';
        var isVideo = media.type === 'video';
        var url = media.url;
        if (isVideo) {
            item.innerHTML = '<video src="' + url + '" muted></video><div class="play-overlay"><i class="fas fa-play"></i></div><span class="media-type-tag">Video</span>';
            item.onclick = function(e) { e.stopPropagation(); openLightbox(url, 'video'); };
        } else {
            item.innerHTML = '<img src="' + url + '" alt="Incident media" onerror="this.style.display=\'none\'"><span class="media-type-tag">Image</span>';
            item.onclick = function(e) { e.stopPropagation(); openLightbox(url, 'image'); };
        }
        list.appendChild(item);
    });
}

function openLightbox(mediaUrl, mediaType) {
    var lightbox = document.getElementById('mediaLightbox');
    var content = document.getElementById('lightboxContent');
    if (!lightbox || !content) { window.open(mediaUrl, '_blank'); return; }
    if (mediaType === 'video') {
        content.innerHTML = '<video controls autoplay style="max-width:100%;max-height:85vh;border-radius:12px;"><source src="' + mediaUrl + '" type="video/mp4"></video>';
    } else {
        content.innerHTML = '<img src="' + mediaUrl + '" alt="Incident media" style="max-width:100%;max-height:85vh;border-radius:12px;">';
    }
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    var lightbox = document.getElementById('mediaLightbox');
    var content = document.getElementById('lightboxContent');
    if (lightbox) lightbox.classList.remove('active');
    if (content) content.innerHTML = '';
    document.body.style.overflow = '';
}

function viewIncidentMedia(mediaUrls) {
    var urls = mediaUrls;
    if (typeof mediaUrls === 'string') { try { urls = JSON.parse(mediaUrls); } catch (e) { urls = []; } }
    if (!urls || urls.length === 0) { showToast('No media attached', 'info'); return; }
    openLightbox(urls[0].url, urls[0].type);
}

// ============================================
// PRIORITY META
// ============================================
function getPriorityMeta(priority) {
    var p = (priority || 'medium').toLowerCase();
    var meta = {
        critical: { icon: 'fa-exclamation-triangle', label: 'CRITICAL', cls: 'critical' },
        high:     { icon: 'fa-exclamation-circle',  label: 'HIGH',     cls: 'high' },
        medium:   { icon: 'fa-info-circle',         label: 'MEDIUM',   cls: 'medium' },
        low:      { icon: 'fa-circle-info',         label: 'LOW',      cls: 'low' }
    };
    return meta[p] || meta.medium;
}

// ============================================
// EMERGENCY POPUP (incident reports)
// ============================================
function startPopupTimer() {
    if (popupTimerInterval) clearInterval(popupTimerInterval);
    var timerText = document.getElementById('popupTimerText');
    if (!timerText || !popupData) return;
    function update() { timerText.textContent = timeAgo(popupData.created_at); }
    update();
    popupTimerInterval = setInterval(update, 30000);
}

function stopPopupTimer() {
    if (popupTimerInterval) { clearInterval(popupTimerInterval); popupTimerInterval = null; }
}

function showEmergencyPopup(incident) {
    if (!incident || !incident.id) return;
    if (incident.status && incident.status !== 'reported') {
        console.log('Skipping popup — incident already ' + incident.status);
        return;
    }
    popupData = incident;
    var meta = getPriorityMeta(incident.priority);
    var banner = document.getElementById('popupPriorityBanner');
    var icon = document.getElementById('popupPriorityIcon');
    var label = document.getElementById('popupPriorityLabel');
    var content = document.getElementById('emergencyPopupContent');

    if (banner) banner.className = 'popup-priority-banner ' + meta.cls;
    if (icon) icon.innerHTML = '<i class="fas ' + meta.icon + '"></i>';
    if (label) label.textContent = meta.label;
    if (content) {
        content.classList.remove('critical', 'high', 'medium', 'low');
        if (incident.priority) content.classList.add(incident.priority);
    }

    var setText = function(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val || '—';
    };
    setText('popupIncidentTitle', incident.title || 'Untitled Incident');
    setText('popupIncidentType', incident.type || 'Unknown');
    setText('popupIncidentLocation', formatLocationForPopup(incident.location));
    setText('popupTime', formatDateTime(incident.created_at));
    setText('popupContact', incident.contact_number || 'Not provided');
    setText('popupReporter', 'Loading…');

    var legacy = document.getElementById('popupIncidentPriority');
    if (legacy) {
        legacy.textContent = incident.priority || 'Medium';
        legacy.className = 'badge priority-' + (incident.priority || 'medium');
    }

    if (incident.reporter_id) {
        supabaseClient.from('profiles').select('full_name').eq('id', incident.reporter_id).maybeSingle()
            .then(function(result) {
                var reporterEl = document.getElementById('popupReporter');
                if (reporterEl) reporterEl.textContent = (result.data && result.data.full_name) ? result.data.full_name : 'Anonymous';
            })
            .catch(function() {
                var reporterEl = document.getElementById('popupReporter');
                if (reporterEl) reporterEl.textContent = 'Anonymous';
            });
    } else {
        setText('popupReporter', 'Anonymous');
    }

    renderPopupMedia(getMediaUrls(incident));

    var popup = document.getElementById('emergencyPopup');
    if (popup) popup.classList.add('active');

    var siren = document.getElementById('sirenIndicator');
    if (siren) { siren.classList.add('show'); siren.style.display = 'inline-flex'; }

    playSirenSound();
    startPopupTimer();
    document.body.style.overflow = 'hidden';
    console.log('🚨 Emergency popup shown:', incident.id, '[' + (incident.priority || 'medium') + ']');
}

function closePopup() {
    stopSirenSound();
    stopPopupTimer();
    var popup = document.getElementById('emergencyPopup');
    if (popup) popup.classList.remove('active');
    var siren = document.getElementById('sirenIndicator');
    if (siren) { siren.classList.remove('show'); siren.style.display = 'none'; }
    document.body.style.overflow = '';
    popupData = null;
}

// ============================================
// ACKNOWLEDGE
// ============================================
async function acknowledgePopup() {
    if (!popupData) { showToast('No incident data found', 'warning'); return; }
    var btn = document.getElementById('acknowledgeBtn');
    var originalHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Acknowledging…'; }

    try {
        stopSirenSound();
        var updateData = { status: 'acknowledged', updated_at: new Date().toISOString() };
        try {
            updateData.acknowledged_at = new Date().toISOString();
            updateData.acknowledged_by = currentUser ? currentUser.id : null;
        } catch (e) {}

        var result = await supabaseClient.from('incident_reports').update(updateData).eq('id', popupData.id);
        if (result.error) {
            if (result.error.message.includes('column') && result.error.message.includes('does not exist')) {
                var retryResult = await supabaseClient.from('incident_reports')
                    .update({ status: 'acknowledged', updated_at: new Date().toISOString() }).eq('id', popupData.id);
                if (retryResult.error) throw retryResult.error;
            } else throw result.error;
        }

        showToast('✅ Emergency acknowledged successfully!', 'success');
        try {
            if (typeof window.sendEmergencyEmailNotification === 'function') {
                var emailResult = await window.sendEmergencyEmailNotification(popupData, true);
                if (emailResult && emailResult.success) showToast('📧 Email notifications sent!', 'success', 5000);
            }
        } catch (emailError) { console.error('Email error:', emailError); }

        closePopup();
        setTimeout(function() { loadDashboard(); }, 400);
    } catch (error) {
        console.error('Acknowledge error:', error);
        showToast('Failed to acknowledge: ' + error.message, 'danger');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHTML || '<i class="fas fa-check"></i> Acknowledge &amp; Dispatch'; }
    }
}

// ============================================
// ALERT NOTIFICATION POPUP (for admin-sent alerts)
// ============================================
function showAlertNotificationPopup(notif) {
    if (!notif || !notif.id) return;

    // Avoid duplicates
    if (processedNotificationIds.has(notif.id)) return;
    processedNotificationIds.add(notif.id);

    var existing = document.getElementById('alertNotificationPopup');
    if (existing) existing.remove();

    var priority = (notif.priority || 'medium').toLowerCase();
    var priorityColor = {
        critical: '#dc3545', high: '#fd7e14', medium: '#ffc107', low: '#0d6efd'
    }[priority] || '#6c757d';

    var alertType = (notif.data && notif.data.alert_type) ? notif.data.alert_type : 'other';
    var icon = getTypeIcon(alertType);

    var popup = document.createElement('div');
    popup.id = 'alertNotificationPopup';
    popup.style.cssText = `
        position: fixed; top: 80px; right: 20px; z-index: 99997;
        max-width: 380px; background: var(--card); color: var(--card-foreground);
        border-radius: calc(var(--radius) + 6px); border: 1px solid var(--border);
        box-shadow: 0 24px 60px -16px rgba(0,0,0,0.45), 0 0 0 1px var(--border);
        overflow: hidden; animation: alertPopupIn 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        border-left: 5px solid ${priorityColor};
    `;

    popup.innerHTML = `
        <div style="padding: 0.85rem 1rem; background: color-mix(in oklab, ${priorityColor} 12%, var(--card)); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 0.6rem;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: ${priorityColor}; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-bullhorn" style="font-size: 0.9rem;"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-family: 'Sora', sans-serif; font-weight: 800; font-size: 0.82rem; color: ${priorityColor}; text-transform: uppercase; letter-spacing: 0.06em;">
                    🚨 Barangay Alert · ${priority.toUpperCase()}
                </div>
            </div>
            <button type="button" onclick="dismissAlertPopup()" style="background: transparent; border: none; color: var(--muted-foreground); font-size: 1.2rem; cursor: pointer; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%;" onmouseover="this.style.background='var(--muted)'" onmouseout="this.style.background='transparent'">&times;</button>
        </div>
        <div style="padding: 1rem;">
            <div style="display: flex; align-items: flex-start; gap: 0.7rem; margin-bottom: 0.7rem;">
                <div style="width: 40px; height: 40px; border-radius: calc(var(--radius) + 2px); background: color-mix(in oklab, ${priorityColor} 18%, transparent); color: ${priorityColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas ${icon}" style="font-size: 1rem;"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-family: 'Sora', sans-serif; font-weight: 800; font-size: 0.95rem; color: var(--card-foreground); margin-bottom: 0.25rem; word-break: break-word;">
                        ${escapeHtml(notif.title || 'Alert')}
                    </div>
                    <div style="font-size: 0.82rem; color: var(--muted-foreground); line-height: 1.5; word-break: break-word;">
                        ${escapeHtml((notif.message || '').substring(0, 180))}${(notif.message || '').length > 180 ? '…' : ''}
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button type="button" onclick="dismissAlertPopup()" style="font-size: 0.75rem; font-weight: 700; padding: 0.4rem 0.85rem; border-radius: 9999px; background: var(--card); color: var(--foreground); border: 1px solid var(--border); cursor: pointer;">
                    Dismiss
                </button>
                <button type="button" onclick="openAlertsFromPopup()" style="font-size: 0.75rem; font-weight: 700; padding: 0.4rem 0.85rem; border-radius: 9999px; background: var(--primary); color: var(--primary-foreground); border: none; cursor: pointer;">
                    <i class="fas fa-bell me-1"></i> View Alerts
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);
    setTimeout(function() {
        var p = document.getElementById('alertNotificationPopup');
        if (p) {
            p.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            p.style.opacity = '0';
            p.style.transform = 'translateX(400px)';
            setTimeout(function() { p.remove(); }, 350);
        }
    }, 15000);
}

window.dismissAlertPopup = function() {
    var p = document.getElementById('alertNotificationPopup');
    if (p) {
        p.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        p.style.opacity = '0';
        p.style.transform = 'translateX(400px)';
        setTimeout(function() { p.remove(); }, 350);
    }
};

window.openAlertsFromPopup = function() {
    window.dismissAlertPopup();
    var alertsLink = document.getElementById('alertsLink');
    if (alertsLink) {
        document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(function(l) { l.classList.remove('active'); });
        alertsLink.classList.add('active');
        loadPage('alerts');
    }
};

async function markAllNotificationsRead() {
    if (!currentUser) return;
    try {
        await supabaseClient.from('notifications').update({ read: true })
            .eq('user_id', currentUser.id).eq('read', false);
        unreadAlertsCount = 0;
        updateAlertsBadge();
    } catch (e) { console.warn('Mark-all-read failed:', e); }
}

// ============================================
// NOTIFICATIONS — REALTIME + BADGE
// ============================================
async function refreshUnreadAlertsCount() {
    if (!currentUser) return;
    try {
        var result = await supabaseClient
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', currentUser.id)
            .eq('read', false)
            .eq('type', 'alert');
        unreadAlertsCount = result.count || 0;
        updateAlertsBadge();
    } catch (e) { console.warn('Count unread alerts failed:', e); }
}

function updateAlertsBadge() {
    var alertsLink = document.getElementById('alertsLink');
    if (!alertsLink) return;
    var badge = alertsLink.querySelector('.alerts-badge');
    if (unreadAlertsCount > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'alerts-badge';
            alertsLink.appendChild(badge);
        }
        badge.textContent = unreadAlertsCount > 99 ? '99+' : String(unreadAlertsCount);
    } else if (badge) {
        badge.remove();
    }
}

function setupNotificationsRealtime() {
    if (!currentUser) return;
    if (notificationsRealtimeChannel) {
        try { supabaseClient.removeChannel(notificationsRealtimeChannel); } catch(e) {}
    }

    notificationsRealtimeChannel = supabaseClient
        .channel('notifications-realtime-' + currentUser.id)
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'notifications',
            filter: `user_id=eq.${currentUser.id}`
        }, function(payload) {
            var notif = payload.new;
            if (!notif) return;
            console.log('🔔 New notification:', notif);

            unreadAlertsCount++;
            updateAlertsBadge();

            // Popup — same behavior as incident report popup
            showAlertNotificationPopup(notif);

            try {
                if (audioContext && audioContext.state === 'running') {
                    var osc = audioContext.createOscillator();
                    var gain = audioContext.createGain();
                    osc.connect(gain); gain.connect(audioContext.destination);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(880, audioContext.currentTime);
                    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
                    osc.start(audioContext.currentTime);
                    osc.stop(audioContext.currentTime + 0.25);
                }
            } catch (e) {}

            var activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
            if (activePage === 'alerts') loadAlerts();
        })
        .subscribe(function(status) {
            console.log('📡 Notifications realtime status:', status);
        });
}

// ============================================
// INIT DASHBOARD
// ============================================
async function initResponderDashboard() {
    try {
        if (isInitialized) return;
        console.log('🔧 Initializing Responder Dashboard…');

        startRealtimeEarly();

        var sessionData = await supabaseClient.auth.getSession();
        var session = sessionData.data.session;
        if (!session) { window.location.href = '../login.html'; return; }

        currentUser = session.user;
        var profileResult = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
        if (profileResult.error || !profileResult.data) { showToast('Error loading profile', 'danger'); return; }

        currentProfile = profileResult.data;
        if (currentProfile.role !== 'responder' && currentProfile.role !== 'admin') {
            showToast('Access denied', 'danger');
            await supabaseClient.auth.signOut();
            window.location.href = '../login.html';
            return;
        }

        var userNameDisplay = document.getElementById('userNameDisplay');
        if (userNameDisplay) {
            userNameDisplay.textContent = (currentProfile.full_name || 'Responder') + ' (' + currentProfile.role + ')';
        }

        // ============================================================
        // ROLE-BASED SIDEBAR VISIBILITY
        // - Alerts link: ALWAYS visible (both admin + responder)
        // - Responders link: ADMIN only
        // ============================================================
        var rl = document.getElementById('respondersLink');
        var al = document.getElementById('alertsLink');
        if (currentProfile.role === 'admin') {
            if (rl) rl.style.display = 'block';
        } else {
            if (rl) rl.style.display = 'none';
        }
        if (al) al.style.display = 'flex';

        actionModal = new bootstrap.Modal(document.getElementById('actionModal'));
        addResponderModal = new bootstrap.Modal(document.getElementById('addResponderModal'));
        alertModal = new bootstrap.Modal(document.getElementById('alertModal'));

        initGemini();
        setupAlertModal();

        await loadDashboard();

        setupNotificationsRealtime();
        await refreshUnreadAlertsCount();

        document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                var href = this.getAttribute('href');
                if (href && href !== '#') return;
                e.preventDefault();
                var targetPage = this.dataset.page;
                if (!targetPage) return;

                // Only admins can access Responders page
                if (targetPage === 'responders' && currentProfile.role !== 'admin') {
                    showToast('Access denied. Admins only.', 'warning', 4000);
                    return;
                }

                document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(function(l) { l.classList.remove('active'); });
                this.classList.add('active');
                loadPage(targetPage);
            });
        });

        setupPolling();
        await checkNewEmergencies();

        isInitialized = true;
        console.log('✅ Responder Dashboard initialized');
    } catch (error) {
        console.error('Init error:', error);
        showToast('Error loading dashboard', 'danger');
    }
}

// ============================================
// REALTIME — incidents
// ============================================
function startRealtimeEarly() {
    if (realtimeChannel) { try { supabaseClient.removeChannel(realtimeChannel); } catch (e) {} }

    realtimeChannel = supabaseClient
        .channel('responder-realtime-v2', { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports' }, function(payload) {
            var inc = payload.new;
            if (!inc) return;
            console.log('🔔 Realtime INSERT:', inc.id, inc.status);
            if (inc.status === 'reported' && !processedIncidentIds.has(inc.id)) {
                processedIncidentIds.add(inc.id);
                showEmergencyPopup(inc);
                showToast('🚨 NEW EMERGENCY REPORTED!', 'emergency', 10000);
                var activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
                if (activePage === 'incidents') refreshIncidentsListInPlace();
                else if (activePage === 'analytics') refreshAnalyticsDataInPlace();
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports' }, function(payload) {
            var inc = payload.new;
            if (!inc) return;
            var idx = allIncidents.findIndex(function(i) { return i.id === inc.id; });
            if (idx >= 0) allIncidents[idx] = Object.assign({}, allIncidents[idx], inc);
            else allIncidents.unshift(inc);

            if (popupData && popupData.id === inc.id && inc.status !== 'reported') {
                stopSirenSound();
                closePopup();
                showToast('Incident status updated to ' + inc.status, 'info');
            }
            var activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
            if (activePage === 'incidents') refreshIncidentsListInPlace();
            else if (activePage === 'analytics') refreshAnalyticsDataInPlace();
        })
        .subscribe(function(status) { console.log('📡 Realtime channel status:', status); });
}

// ============================================
// POLLING FALLBACK
// ============================================
function setupPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async function() {
        try {
            var reportsResult = await supabaseClient.from('incident_reports').select('*')
                .eq('status', 'reported').order('created_at', { ascending: false }).limit(3);
            var reports = reportsResult.data || [];
            if (reports.length > 0) {
                var latest = reports[0];
                if (!processedIncidentIds.has(latest.id)) {
                    processedIncidentIds.add(latest.id);
                    showEmergencyPopup(latest);
                    showToast('🚨 NEW EMERGENCY REPORTED!', 'emergency', 10000);
                }
            }
        } catch (error) {}
    }, 3000);
}

async function checkNewEmergencies() {
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*')
            .eq('status', 'reported').order('created_at', { ascending: false }).limit(1);
        var reports = reportsResult.data || [];
        if (reports.length > 0) {
            var latestReport = reports[0];
            if (!processedIncidentIds.has(latestReport.id)) {
                processedIncidentIds.add(latestReport.id);
                showEmergencyPopup(latestReport);
            }
        }
    } catch (error) { console.error('Check emergencies error:', error); }
}

// ============================================
// PAGE ROUTING
// ============================================
function loadPage(page) {
    // Only admins can access Responders page
    if (page === 'responders' && currentProfile && currentProfile.role !== 'admin') {
        showToast('Access denied. Admins only.', 'warning', 4000);
        return;
    }

    isOnIncidentsPage = (page === 'incidents');
    if (page !== 'analytics') destroyAllCharts();
    if (page !== 'dashboard' && responderMap) destroyResponderMap();

    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'incidents': loadIncidents(); break;
        case 'analytics': loadAnalytics(); break;
        case 'responders': loadResponders(); break;
        case 'alerts': loadAlerts(); break;
        case 'profile': loadProfile(); break;
        default: loadDashboard();
    }
}

// ============================================
// DASHBOARD — professional stat cards
// ============================================
async function loadDashboard() {
    var container = document.getElementById('pageContent');
    if (!container) return;

    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;

        var total = reports.length || 0;
        var active = reports.filter(function(r) { return !['resolved', 'closed'].includes(r.status); }).length || 0;
        var critical = reports.filter(function(r) { return r.priority === 'critical' && !['resolved', 'closed'].includes(r.status); }).length || 0;
        var resolved = reports.filter(function(r) { return r.status === 'resolved'; }).length || 0;

        var isAdmin = currentProfile && currentProfile.role === 'admin';

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h4 class="fw-bold mb-1">Responder Dashboard</h4>
                    <p class="text-muted mb-0">Barangay ${escapeHtml(currentProfile?.barangay || 'N/A')}</p>
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    ${isAdmin ? `
                        <button class="btn btn-danger d-inline-flex align-items-center gap-2" onclick="openAlertModal()">
                            <i class="fas fa-broadcast-tower"></i>
                            <span>Send Alert</span>
                        </button>
                        <button class="btn btn-primary d-inline-flex align-items-center gap-2" onclick="addResponderModal.show()">
                            <i class="fas fa-user-plus"></i>
                            <span>Add Responder</span>
                        </button>
                    ` : ''}
                </div>
            </div>

            <div class="row g-3 mb-4">
                <div class="col-6 col-lg-3">
                    <div class="stat-card-professional accent-primary">
                        <div class="stat-info"><div class="stat-num">${total}</div><div class="stat-lbl">Total Incidents</div></div>
                        <div class="stat-icon-right blue"><i class="fas fa-file-alt"></i></div>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
                    <div class="stat-card-professional accent-warning">
                        <div class="stat-info"><div class="stat-num">${active}</div><div class="stat-lbl">Active</div></div>
                        <div class="stat-icon-right yellow"><i class="fas fa-clock"></i></div>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
                    <div class="stat-card-professional accent-danger">
                        <div class="stat-info"><div class="stat-num">${critical}</div><div class="stat-lbl">Critical</div></div>
                        <div class="stat-icon-right red"><i class="fas fa-exclamation-triangle"></i></div>
                    </div>
                </div>
                <div class="col-6 col-lg-3">
                    <div class="stat-card-professional accent-success">
                        <div class="stat-info"><div class="stat-num">${resolved}</div><div class="stat-lbl">Resolved</div></div>
                        <div class="stat-icon-right green"><i class="fas fa-check-circle"></i></div>
                    </div>
                </div>
            </div>

            <!-- LIVE BARANGAY MAP -->
            <div class="dashboard-map-card">
                <div class="dashboard-map-header">
                    <h6><i class="fas fa-map-marked-alt"></i>Live Barangay Map</h6>
                    <span class="text-muted small"><i class="fas fa-circle" style="color:var(--primary);font-size:0.5rem;animation:pulse-dot 1.6s infinite;"></i> Real-time · Residents + Facebook reports</span>
                </div>
                <div class="dashboard-map-body">
                    <div id="responderMap"></div>
                    <div class="map-legend">
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
                    <div class="map-status-bar" id="responderMapStatusBar">
                        <span class="map-live-dot"></span>Loading…
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h6 class="mb-0"><i class="fas fa-list me-2"></i>Recent Incidents</h6>
                    <button class="btn btn-sm btn-outline-secondary" onclick="loadIncidents()">View All</button>
                </div>
                <div class="card-body p-0">
                    ${reports && reports.length > 0 ? `
                        <div class="list-group list-group-flush">
                            ${reports.slice(0, 5).map(function(incident) {
                                var mediaUrls = getMediaUrls(incident);
                                var priority = incident.priority || 'medium';
                                var typeClass = getTypeClass(incident.type);
                                var typeIcon = getTypeIcon(incident.type);
                                var pulse = getPriorityPulseClasses(priority);
                                return `
                                    <div class="list-group-item d-flex align-items-center gap-3 ${pulse.card}">
                                        <div class="incident-type-icon ${typeClass} ${pulse.icon}" style="width:36px;height:36px;font-size:0.9rem;">
                                            <i class="fas ${typeIcon}"></i>
                                        </div>
                                        <span class="badge priority-${priority}">${priority}</span>
                                        <div class="flex-grow-1">
                                            <div class="fw-semibold">${escapeHtml(incident.title || 'Untitled')}</div>
                                            <div class="small text-muted">${escapeHtml(incident.type || '')} • ${escapeHtml(formatLocationForPopup(incident.location))}</div>
                                            ${mediaUrls.length > 0 ? `<div class="small text-primary"><i class="fas fa-paperclip me-1"></i>${mediaUrls.length} attachment(s)</div>` : ''}
                                        </div>
                                        <span class="status-badge status-${incident.status}">${incident.status}</span>
                                        <button class="btn btn-sm btn-outline-primary" onclick="openActionModal('${incident.id}')"><i class="fas fa-edit"></i></button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : `
                        <div class="text-center py-4 text-muted"><i class="fas fa-check-circle fa-2x mb-2 d-block text-success"></i>No incidents reported</div>
                    `}
                </div>
            </div>
        `;

        setTimeout(initResponderMap, 200);
    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Error loading dashboard</div>';
    }
}

// ============================================
// RESPONDER MAP
// ============================================
function initResponderMap() {
    const mapEl = document.getElementById('responderMap');
    if (!mapEl || responderMap) return;

    responderMap = L.map('responderMap', { zoomControl: true, attributionControl: false })
        .setView([BARANGAY_SCOPE.centerLat, BARANGAY_SCOPE.centerLng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(responderMap);

    responderBoundaryLayer = L.polygon(BARANGAY_SCOPE.polygon, {
        color: '#2e7d32', weight: 2.5, opacity: 0.85,
        fillColor: '#2e7d32', fillOpacity: 0.06,
        dashArray: '10 5', className: 'barangay-boundary'
    }).addTo(responderMap);

    responderBoundaryLayer.bindTooltip('Barangay Culiat Scope', { permanent: false, direction: 'center' });
    responderMap.fitBounds(responderBoundaryLayer.getBounds(), { padding: [20, 20] });

    loadResponderMapIncidents();
    setupResponderMapRealtime();

    setTimeout(function() { if (responderMap) responderMap.invalidateSize(); }, 300);
}

function destroyResponderMap() {
    if (responderMap) { try { responderMap.remove(); } catch(e) {} responderMap = null; }
    responderMarkers = [];
    responderMapData = [];
    if (responderMapRealtime1) { try { supabaseClient.removeChannel(responderMapRealtime1); } catch(e) {} responderMapRealtime1 = null; }
    if (responderMapRealtime2) { try { supabaseClient.removeChannel(responderMapRealtime2); } catch(e) {} responderMapRealtime2 = null; }
}

async function loadResponderMapIncidents() {
    if (!responderMap) return;
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sinceIso = thirtyDaysAgo.toISOString();

        const [incidentRes, emergencyRes] = await Promise.all([
            supabaseClient.from('incident_reports').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(100),
            supabaseClient.from('emergencies').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(100)
        ]);

        const fromResidents = (incidentRes.data || []).map(r => normalizeMapRow(r, 'resident'));
        const fromFacebook = (emergencyRes.data || []).map(r => normalizeMapRow(r, 'facebook'));

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
        responderMapData = deduped;

        renderResponderMarkers(responderMapData);
        await geocodeMissingResponderIncidents();
        renderResponderMarkers(responderMapData);
        updateResponderMapStatusBar(responderMapData);
    } catch (err) { console.warn('Failed to load map incidents:', err); }
}

function normalizeMapRow(row, source) {
    let coords = extractCoords(row.location);
    if (!coords && row.latitude != null && row.longitude != null) {
        coords = { lat: parseFloat(row.latitude), lng: parseFloat(row.longitude) };
    }
    if (!coords && row.lat != null && row.lng != null) {
        coords = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
    }
    return {
        id: row.id, type: row.type || 'other', title: row.title || 'Untitled Incident',
        description: row.description || '', location: row.location,
        priority: row.priority || 'medium', status: row.status || 'reported',
        created_at: row.created_at, barangay: row.barangay || null,
        contact_number: row.contact_number || row.reporter_phone || null,
        reporter_name: row.reporter_name || null, source: source,
        _lat: coords ? coords.lat : null, _lng: coords ? coords.lng : null
    };
}

function extractCoords(location) {
    if (!location) return null;
    if (typeof location === 'string' && location.trim().startsWith('{')) {
        try {
            var obj = JSON.parse(location);
            if (obj.latitude != null && obj.longitude != null) return { lat: parseFloat(obj.latitude), lng: parseFloat(obj.longitude) };
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

async function geocodeMissingResponderIncidents() {
    const needsGeocode = responderMapData.filter(i => i._lat == null || i._lng == null);
    if (needsGeocode.length === 0) return;
    console.log(`🗺️ Geocoding ${needsGeocode.length} incidents...`);
    for (const inc of needsGeocode) {
        const coords = await geocodeLocationString(inc.location);
        if (coords) { inc._lat = coords.lat; inc._lng = coords.lng; }
        else { inc._lat = BARANGAY_SCOPE.centerLat; inc._lng = BARANGAY_SCOPE.centerLng; inc._geocodeFallback = true; }
        await new Promise(r => setTimeout(r, 1100));
    }
}

function renderResponderMarkers(incidents) {
    if (!responderMap) return;
    responderMarkers.forEach(function(m) { try { responderMap.removeLayer(m); } catch(e) {} });
    responderMarkers = [];

    incidents.forEach(function(incident) {
        if (incident._lat == null || incident._lng == null) return;
        const type = incident.type || 'other';
        const typeIcon = getTypeIcon(type);
        const typeClass = getTypeClass(type);
        const priority = incident.priority || 'medium';
        const status = incident.status || 'reported';
        const isResolved = status === 'resolved' || status === 'closed';
        const isFacebook = incident.source === 'facebook';

        const badgeHTML = isFacebook
            ? `<span style="position:absolute;top:-4px;right:-4px;background:#0084FF;color:#fff;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;border:1.5px solid #fff;font-weight:900;z-index:5;">f</span>`
            : '';

        const iconHtml = `
            <div class="marker-pin ${typeClass} ${priority} ${isResolved ? 'resolved' : ''}" style="position:relative;">
                <div class="marker-pulse-ring"></div>
                <i class="fas ${typeIcon}"></i>
                ${badgeHTML}
            </div>
        `;

        const customIcon = L.divIcon({
            html: iconHtml, className: 'custom-incident-marker',
            iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
        });

        const marker = L.marker([incident._lat, incident._lng], { icon: customIcon }).addTo(responderMap);

        const createdDate = incident.created_at
            ? new Date(incident.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Unknown';
        const shortDesc = incident.description
            ? String(incident.description).substring(0, 100) + (String(incident.description).length > 100 ? '…' : '')
            : 'No description';

        const sourceBadge = isFacebook
            ? `<span class="source-badge-fb"><i class="fab fa-facebook-messenger"></i>FB</span>`
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
                <button class="map-popup-btn" onclick="viewIncidentDetails('${incident.id}')">
                    <i class="fas fa-eye"></i> View Details
                </button>
            </div>
        `;

        marker.bindPopup(popupHtml, { maxWidth: 280, minWidth: 220, closeButton: true, autoPan: true });
        responderMarkers.push(marker);
    });
}

function updateResponderMapStatusBar(incidents) {
    var bar = document.getElementById('responderMapStatusBar');
    if (!bar) return;
    var activeCount = incidents.filter(function(i) { return !['resolved', 'closed', 'processed'].includes(i.status); }).length;
    var criticalCount = incidents.filter(function(i) { return i.priority === 'critical' && !['resolved', 'closed', 'processed'].includes(i.status); }).length;
    var fbCount = incidents.filter(function(i) { return i.source === 'facebook' && !['resolved', 'closed', 'processed'].includes(i.status); }).length;
    var text = activeCount === 0 ? 'All clear in your barangay' : activeCount + ' active incident' + (activeCount > 1 ? 's' : '');
    if (criticalCount > 0) text = '🚨 ' + criticalCount + ' CRITICAL incident' + (criticalCount > 1 ? 's' : '');
    else if (fbCount > 0) text += ' · 📘 ' + fbCount + ' from Facebook';
    bar.innerHTML = '<span class="map-live-dot"></span>' + escapeHtml(text);
}

function setupResponderMapRealtime() {
    if (responderMapRealtime1) { try { supabaseClient.removeChannel(responderMapRealtime1); } catch(e) {} }
    if (responderMapRealtime2) { try { supabaseClient.removeChannel(responderMapRealtime2); } catch(e) {} }

    responderMapRealtime1 = supabaseClient.channel('responder-map-residents')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports' }, function(payload) {
            if (!payload.new) return;
            handleNewResponderMapIncident(payload.new, 'resident');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports' }, function(payload) {
            if (!payload.new) return;
            handleUpdateResponderMapIncident(payload.new, 'resident');
        })
        .subscribe();

    responderMapRealtime2 = supabaseClient.channel('responder-map-facebook')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emergencies' }, function(payload) {
            if (!payload.new) return;
            handleNewResponderMapIncident(payload.new, 'facebook');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'emergencies' }, function(payload) {
            if (!payload.new) return;
            handleUpdateResponderMapIncident(payload.new, 'facebook');
        })
        .subscribe();
}

async function handleNewResponderMapIncident(newRow, source) {
    const normalized = normalizeMapRow(newRow, source);
    if (normalized._lat == null || normalized._lng == null) {
        const coords = await geocodeLocationString(normalized.location);
        if (coords) { normalized._lat = coords.lat; normalized._lng = coords.lng; }
        else { normalized._lat = BARANGAY_SCOPE.centerLat; normalized._lng = BARANGAY_SCOPE.centerLng; normalized._geocodeFallback = true; }
    }
    const exists = responderMapData.find(function(i) { return i.id === normalized.id; });
    if (exists) return;
    responderMapData.unshift(normalized);
    renderResponderMarkers(responderMapData);
    updateResponderMapStatusBar(responderMapData);
}

function handleUpdateResponderMapIncident(newRow, source) {
    const idx = responderMapData.findIndex(function(i) { return i.id === newRow.id; });
    if (idx >= 0) {
        const normalized = normalizeMapRow(newRow, source);
        if (normalized._lat == null) {
            normalized._lat = responderMapData[idx]._lat;
            normalized._lng = responderMapData[idx]._lng;
        }
        responderMapData[idx] = Object.assign({}, responderMapData[idx], normalized);
        renderResponderMarkers(responderMapData);
        updateResponderMapStatusBar(responderMapData);
    }
}

// ============================================
// ALERT MODAL — MAP + GEOCODE + MEDIA + AI
// ============================================
function setupAlertModal() {
    var alertModalEl = document.getElementById('alertModal');
    if (alertModalEl) {
        alertModalEl.addEventListener('shown.bs.modal', function() {
            if (!alertMapInitialized) setTimeout(initAlertMap, 300);
            else if (alertMap) setTimeout(function() { alertMap.invalidateSize(); }, 300);
        });
        alertModalEl.addEventListener('hidden.bs.modal', function() { resetAlertForm(); });
    }

    var alertGeolocateBtn = document.getElementById('alertGeolocateBtn');
    if (alertGeolocateBtn) {
        alertGeolocateBtn.addEventListener('click', function() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(pos) {
                    const lat = pos.coords.latitude, lng = pos.coords.longitude;
                    if (alertMap && alertMapMarker) {
                        alertMap.setView([lat, lng], 16);
                        alertMapMarker.setLatLng([lat, lng]);
                        updateAlertCoordDisplay(lat, lng);
                        reverseGeocodeAlert(lat, lng);
                        showToast('📍 Location updated from GPS', 'success');
                    }
                }, function() { showToast('Unable to get GPS location', 'danger'); });
            } else showToast('Geolocation not supported', 'warning');
        });
    }

    var alertLocationInput = document.getElementById('alertLocation');
    if (alertLocationInput) {
        alertLocationInput.addEventListener('input', function(e) {
            const query = this.value.trim();
            if (query.length < 3) { document.getElementById('alertGeocodeSuggestions').classList.remove('show'); return; }
            clearTimeout(alertGeocodeTimeout);
            alertGeocodeTimeout = setTimeout(() => { searchAlertLocation(query); }, 500);
        });
        alertLocationInput.addEventListener('blur', function() {
            setTimeout(() => { document.getElementById('alertGeocodeSuggestions').classList.remove('show'); }, 300);
        });
        alertLocationInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = this.value.trim();
                if (query.length >= 3) searchAlertLocation(query);
            }
        });
    }

    setupAlertMediaUpload();
}

function resetAlertForm() {
    var form = document.getElementById('alertForm');
    if (form) form.reset();
    var aiResult = document.getElementById('alertAiAnalysisResult');
    if (aiResult) aiResult.classList.add('d-none');
    var geocodeSug = document.getElementById('alertGeocodeSuggestions');
    if (geocodeSug) geocodeSug.classList.remove('show');
    var autoHint = document.getElementById('autoAlertTypeHint');
    if (autoHint) autoHint.textContent = '';
    window._alertAiResult = null;

    selectedAlertMediaFiles = [];
    clearAlertMediaPreviews();
    var mediaCount = document.getElementById('alertMediaCount');
    if (mediaCount) mediaCount.textContent = '0 / 5';
    var mediaUpload = document.getElementById('alertMediaUpload');
    if (mediaUpload) mediaUpload.value = '';

    if (alertMap && alertMapMarker) {
        alertMap.setView([BARANGAY_SCOPE.centerLat, BARANGAY_SCOPE.centerLng], 14);
        alertMapMarker.setLatLng([BARANGAY_SCOPE.centerLat, BARANGAY_SCOPE.centerLng]);
        updateAlertCoordDisplay(BARANGAY_SCOPE.centerLat, BARANGAY_SCOPE.centerLng);
    }
}

function openAlertModal() {
    if (!currentProfile || currentProfile.role !== 'admin') {
        showToast('Access denied. Admins only.', 'warning', 4000);
        return;
    }
    if (!alertModal) alertModal = new bootstrap.Modal(document.getElementById('alertModal'));
    var contactInput = document.getElementById('alertContact');
    if (contactInput && currentProfile?.contact_number) contactInput.value = currentProfile.contact_number;
    alertModal.show();
}

function initAlertMap() {
    if (alertMapInitialized) return;
    const mapContainer = document.getElementById('alertMap');
    if (!mapContainer) return;
    const defaultLat = BARANGAY_SCOPE.centerLat, defaultLng = BARANGAY_SCOPE.centerLng;
    alertMap = L.map('alertMap').setView([defaultLat, defaultLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(alertMap);
    L.polygon(BARANGAY_SCOPE.polygon, {
        color: '#2e7d32', weight: 2, opacity: 0.8,
        fillColor: '#2e7d32', fillOpacity: 0.08, dashArray: '8 4'
    }).addTo(alertMap);
    alertMapMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(alertMap);
    updateAlertCoordDisplay(defaultLat, defaultLng);
    alertMapMarker.on('dragend', function(e) {
        const pos = alertMapMarker.getLatLng();
        updateAlertCoordDisplay(pos.lat, pos.lng);
        reverseGeocodeAlert(pos.lat, pos.lng);
    });
    alertMap.on('click', function(e) {
        const lat = e.latlng.lat, lng = e.latlng.lng;
        alertMapMarker.setLatLng([lat, lng]);
        updateAlertCoordDisplay(lat, lng);
        reverseGeocodeAlert(lat, lng);
    });
    alertMapInitialized = true;
}

function updateAlertCoordDisplay(lat, lng) {
    var latEl = document.getElementById('alertLat'), lngEl = document.getElementById('alertLng'), coordEl = document.getElementById('alertCoordDisplay');
    if (latEl) latEl.value = lat;
    if (lngEl) lngEl.value = lng;
    if (coordEl) coordEl.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
}

async function searchAlertLocation(query) {
    const suggestions = document.getElementById('alertGeocodeSuggestions');
    const spinner = document.getElementById('alertSearchSpinner');
    if (isAlertGeocoding) return;
    isAlertGeocoding = true;
    if (spinner) spinner.classList.add('show');
    try {
        const viewbox = `${BARANGAY_SCOPE.bounds.west},${BARANGAY_SCOPE.bounds.north},${BARANGAY_SCOPE.bounds.east},${BARANGAY_SCOPE.bounds.south}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=ph&viewbox=${viewbox}&bounded=1`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' } });
        const data = await response.json();
        if (spinner) spinner.classList.remove('show');
        if (data && data.length > 0) {
            suggestions.innerHTML = data.map(item =>
                `<div class="geocode-suggestion-item" data-lat="${item.lat}" data-lon="${item.lon}" data-display="${item.display_name}"><i class="fas fa-map-pin text-danger me-2"></i><span>${item.display_name}</span></div>`
            ).join('');
            suggestions.classList.add('show');
            suggestions.querySelectorAll('.geocode-suggestion-item').forEach(el => {
                el.addEventListener('click', function() {
                    const lat = parseFloat(this.dataset.lat), lon = parseFloat(this.dataset.lon), display = this.dataset.display;
                    document.getElementById('alertLocation').value = display;
                    suggestions.classList.remove('show');
                    if (alertMap && alertMapMarker) {
                        alertMap.setView([lat, lon], 16);
                        alertMapMarker.setLatLng([lat, lon]);
                        updateAlertCoordDisplay(lat, lon);
                    }
                });
            });
        } else suggestions.classList.remove('show');
    } catch (error) {
        if (suggestions) suggestions.classList.remove('show');
    } finally {
        isAlertGeocoding = false;
        if (spinner) spinner.classList.remove('show');
    }
}

async function reverseGeocodeAlert(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'BarangayEMS/1.0' } });
        const data = await response.json();
        if (data && data.display_name) document.getElementById('alertLocation').value = data.display_name;
    } catch (error) { console.error('Reverse geocoding error:', error); }
}

// ============================================
// ALERT MEDIA UPLOAD
// ============================================
function setupAlertMediaUpload() {
    const fileInput = document.getElementById('alertMediaUpload');
    const dropZone = document.getElementById('alertMediaDropZone');
    if (!fileInput || !dropZone) return;
    fileInput.addEventListener('change', function() { handleAlertMediaFiles(this.files); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); this.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleAlertMediaFiles(e.dataTransfer.files);
    });
    dropZone.addEventListener('click', function() { fileInput.click(); });
}

function handleAlertMediaFiles(files) {
    const maxFiles = 5, maxSize = 10 * 1024 * 1024;
    if (selectedAlertMediaFiles.length === 0) clearAlertMediaPreviews();
    let validFiles = [], errorMessages = [];
    for (let file of files) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { errorMessages.push(`${file.name}: Unsupported file type`); continue; }
        if (file.size > maxSize) { errorMessages.push(`${file.name}: File too large (max 10MB)`); continue; }
        if (selectedAlertMediaFiles.length + validFiles.length >= maxFiles) { errorMessages.push(`Maximum ${maxFiles} files allowed`); break; }
        validFiles.push(file);
    }
    if (errorMessages.length > 0) showToast(errorMessages.join('. '), 'warning', 6000);
    if (validFiles.length === 0) return;
    for (let file of validFiles) {
        selectedAlertMediaFiles.push(file);
        const reader = new FileReader();
        reader.onload = function(e) { createAlertMediaPreview(file, e.target.result); };
        reader.readAsDataURL(file);
    }
    updateAlertMediaCount();
}

function createAlertMediaPreview(file, dataUrl) {
    const container = document.getElementById('alertMediaPreviewContainer');
    if (!container) return;
    const isVideo = file.type.startsWith('video/');
    const previewDiv = document.createElement('div');
    previewDiv.className = 'media-preview-item';
    previewDiv.dataset.index = container.children.length;
    if (isVideo) {
        previewDiv.innerHTML = `<video src="${dataUrl}" muted></video><div class="media-type-badge video"><i class="fas fa-video"></i></div><button class="remove-media-btn" onclick="removeAlertMediaFile(${container.children.length})"><i class="fas fa-times"></i></button><div class="media-file-name">${file.name}</div>`;
    } else {
        previewDiv.innerHTML = `<img src="${dataUrl}" alt="${file.name}"><div class="media-type-badge image"><i class="fas fa-image"></i></div><button class="remove-media-btn" onclick="removeAlertMediaFile(${container.children.length})"><i class="fas fa-times"></i></button><div class="media-file-name">${file.name}</div>`;
    }
    container.appendChild(previewDiv);
}

function removeAlertMediaFile(index) {
    if (index >= 0 && index < selectedAlertMediaFiles.length) {
        selectedAlertMediaFiles.splice(index, 1);
        clearAlertMediaPreviews();
        for (let file of selectedAlertMediaFiles) {
            const reader = new FileReader();
            reader.onload = function(e) { createAlertMediaPreview(file, e.target.result); };
            reader.readAsDataURL(file);
        }
        updateAlertMediaCount();
    }
}

function clearAlertMediaPreviews() {
    var container = document.getElementById('alertMediaPreviewContainer');
    if (container) container.innerHTML = '';
}

function updateAlertMediaCount() {
    const countDisplay = document.getElementById('alertMediaCount');
    if (countDisplay) countDisplay.textContent = `${selectedAlertMediaFiles.length} / 5`;
}

async function uploadAlertMediaFiles(alertId) {
    if (selectedAlertMediaFiles.length === 0) return [];
    const uploadedUrls = [], storageBucket = 'incident-media';
    for (let i = 0; i < selectedAlertMediaFiles.length; i++) {
        const file = selectedAlertMediaFiles[i];
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `alerts/${alertId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
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
// ALERT AI ANALYSIS
// ============================================
function initGemini() {
    try {
        console.log('🔍 Checking Gemini setup...');
        if (!window.GEMINI_CONFIG) { console.warn('❌ GEMINI_CONFIG missing'); return false; }
        if (!window.GEMINI_CONFIG.API_KEY || window.GEMINI_CONFIG.API_KEY.indexOf('PASTE_YOUR') !== -1) { console.warn('❌ API key not set'); return false; }
        if (typeof window.GoogleGenerativeAI === 'undefined') { console.warn('❌ SDK missing'); return false; }
        geminiClient = new window.GoogleGenerativeAI(window.GEMINI_CONFIG.API_KEY);
        geminiModel = geminiClient.getGenerativeModel({
            model: window.GEMINI_CONFIG.MODEL || 'gemini-3.6-flash',
            generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: 'application/json' }
        });
        geminiReady = true;
        console.log('✅ Gemini AI ready:', window.GEMINI_CONFIG.MODEL);
        return true;
    } catch (e) { console.warn('❌ Gemini init failed:', e); geminiReady = false; return false; }
}

const TYPE_DETECTION_KEYWORDS = {
    fire: ['fire', 'flame', 'smoke', 'burn', 'burning', 'blaze', 'sunog', 'apoy', 'usok', 'nagniningas', 'nasusunog'],
    medical: ['medical', 'injury', 'sick', 'pain', 'chest pain', 'heart', 'breathing', 'unconscious', 'bleeding', 'faint', 'seizure', 'stroke', 'hospital', 'ambulance', 'medikal', 'sakit', 'sugat', 'nasugatan', 'hindi humihinga', 'walang malay', 'dugo'],
    accident: ['accident', 'crash', 'collision', 'vehicle', 'car', 'motorcycle', 'truck', 'jeepney', 'fell', 'fall', 'hit', 'aksidente', 'bangga', 'nasagasaan', 'nahulog'],
    flood: ['flood', 'flooding', 'flooded', 'water rising', 'overflow', 'river', 'rain', 'typhoon', 'storm', 'drowning', 'baha', 'pagbaha', 'binaha', 'tubig', 'ilog', 'ulan', 'bagyo', 'lunod'],
    crime: ['crime', 'rob', 'robbery', 'theft', 'steal', 'thief', 'burglar', 'attack', 'assault', 'fight', 'weapon', 'gun', 'knife', 'shooting', 'stab', 'murder', 'krimen', 'holdap', 'nakaw', 'magnanakaw', 'pananakit', 'away', 'baril', 'kutsilyo', 'saksak', 'patayan']
};

function detectIncidentType(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    const scores = { fire: 0, medical: 0, accident: 0, flood: 0, crime: 0 };
    Object.keys(TYPE_DETECTION_KEYWORDS).forEach(function(type) {
        TYPE_DETECTION_KEYWORDS[type].forEach(function(kw) {
            if (kw.indexOf(' ') !== -1) { if (text.indexOf(kw) !== -1) scores[type]++; }
            else { const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'); if (re.test(text)) scores[type]++; }
        });
    });
    let detectedType = 'other', maxScore = 0;
    Object.keys(scores).forEach(function(type) { if (scores[type] > maxScore) { maxScore = scores[type]; detectedType = type; } });
    if (maxScore === 0) detectedType = 'other';
    return { type: detectedType, score: maxScore, allScores: scores };
}

const AI_KEYWORDS = {
    critical: {
        3: ['explosion', 'exploded', 'shooting', 'shot', 'stabbing', 'stabbed', 'unconscious', 'not breathing', 'no pulse', 'severe bleeding', 'heart attack', 'stroke', 'cardiac arrest', 'drowning', 'drowned', 'gas leak', 'building collapse', 'collapsed', 'trapped', 'electrocuted', 'electrocution', 'seizure', 'choking', 'overdose', 'pagsabog', 'sumabog', 'bumaril', 'sinaksak', 'saksak', 'walang malay', 'hindi humihinga', 'walang pulso', 'matinding pagdurugo', 'atake sa puso', 'paglunod', 'nalunod', 'pagtagas ng gas', 'gumuhong gusali', 'naipit', 'nakuryente'],
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
    for (var i = 0; i < FAKE_INDICATORS.length; i++) if (aiContainsWord(text, FAKE_INDICATORS[i])) return true;
    var vowels = text.match(/[aeiouáéíóúàèìòùâêîôûäëïöü]/gi);
    if (text.length > 6 && (!vowels || vowels.length < text.length * 0.1)) return true;
    return false;
}

function enhancedAIAnalysis(type, description, location, title) {
    var normDesc = aiNormalize(description || ''), normTitle = aiNormalize(title || ''), normLoc = aiNormalize(location || '');
    var text = (normTitle + ' ' + normDesc + ' ' + normLoc).trim();
    var isNonsense = aiIsNonsense(normDesc) && aiIsNonsense(normTitle);
    var score = 0, matched = [];
    Object.keys(AI_KEYWORDS).forEach(function(cat) {
        Object.keys(AI_KEYWORDS[cat]).forEach(function(w) {
            AI_KEYWORDS[cat][w].forEach(function(kw) {
                if (aiContainsWord(text, kw) && !aiIsNegated(text, kw)) { score += parseInt(w, 10); matched.push(kw); }
            });
        });
    });
    var typeBoost = ['fire','medical','accident','flood','crime'].indexOf(type) !== -1 ? 1 : 0;
    var finalScore = score + typeBoost;
    var priority = 'low', confidence = 0.70;
    if (isNonsense) { priority = 'low'; confidence = 0.40; }
    else if (finalScore >= 8) { priority = 'critical'; confidence = 0.92; }
    else if (finalScore >= 5) { priority = 'high'; confidence = 0.84; }
    else if (finalScore >= 2) { priority = 'medium'; confidence = 0.76; }
    else { priority = 'low'; confidence = 0.68; }
    return {
        priority: priority, confidence: confidence, actions: getActionsForType(type),
        verification: getVerificationText(priority, confidence),
        reasoning: ['Local analysis: ' + (matched.length ? 'matched ' + matched.slice(0,5).join(', ') : 'no strong keywords')],
        detectedLanguage: 'unknown', isNonsense: isNonsense, source: 'rule-based'
    };
}

async function analyzeWithGemini(type, title, description, location) {
    if (!geminiReady || !geminiModel) throw new Error('Gemini not ready');
    const cacheKey = `${type}|${title}|${description}|${location}`.toLowerCase().slice(0, 200);
    if (window.GEMINI_CONFIG && window.GEMINI_CONFIG.ENABLE_CACHE && aiCache.has(cacheKey)) {
        const cached = aiCache.get(cacheKey);
        if (Date.now() - cached.ts < window.GEMINI_CONFIG.CACHE_TTL_MS) return cached.result;
    }
    const prompt = `You are an emergency dispatcher for a Barangay (village) emergency response system in the Philippines.

Analyze the incident report below. You MUST understand English, Tagalog, and mixed Taglish.

Title: ${title}
Description: ${description}
Location: ${location}
User-selected type: ${type}

TASK 1 — DETECT INCIDENT TYPE:
- "fire" (sunog, apoy, usok, nasusunog)
- "medical" (sakit, sugat, ospital, hindi humihinga, atake)
- "accident" (aksidente, bangga, nasagasaan, nahulog)
- "flood" (baha, pagbaha, binaha, paglunod)
- "crime" (holdap, nakaw, saksak, baril, away, pananakit)
- "other"

TASK 2 — DETECT PRIORITY: critical / high / medium / low

Return ONLY this JSON:
{ "detectedType": "fire"|"medical"|"accident"|"flood"|"crime"|"other",
  "priority": "critical"|"high"|"medium"|"low",
  "confidence": 0.0, "reasoning": "...", "detectedLanguage": "english"|"tagalog"|"taglish"|"other",
  "isNonsense": false }`;
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim().replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('Invalid AI response format');
    }
    const validTypes = ['fire', 'medical', 'accident', 'flood', 'crime', 'other'];
    const detectedType = validTypes.indexOf(parsed.detectedType) !== -1 ? parsed.detectedType : type;
    const priority = ['critical','high','medium','low'].indexOf(parsed.priority) !== -1 ? parsed.priority : 'medium';
    const confidence = Math.min(0.99, Math.max(0.5, parseFloat(parsed.confidence) || 0.75));
    const aiResult = {
        priority: priority, confidence: confidence, actions: getActionsForType(detectedType),
        verification: getVerificationText(priority, confidence),
        reasoning: [parsed.reasoning || 'AI classification completed'],
        detectedLanguage: parsed.detectedLanguage || 'unknown',
        detectedType: detectedType, isNonsense: !!parsed.isNonsense, source: 'gemini'
    };
    if (window.GEMINI_CONFIG && window.GEMINI_CONFIG.ENABLE_CACHE) aiCache.set(cacheKey, { result: aiResult, ts: Date.now() });
    return aiResult;
}

function getActionsForType(type) {
    const map = {
        fire: ['Evacuate immediately', 'Call fire department (BFP)', 'Use extinguisher only if safe', 'Avoid smoke inhalation'],
        medical: ['Call ambulance (911)', 'Perform CPR if trained', 'Keep victim calm', 'Do not move injured person'],
        accident: ['Call emergency services', 'Secure the area', 'Provide first aid if safe', 'Direct traffic away'],
        flood: ['Move to higher ground', 'Turn off electricity', 'Avoid walking in floodwater', 'Secure documents'],
        crime: ['Ensure your safety first', 'Call police (117)', 'Do not confront suspects', 'Preserve evidence'],
        other: ['Assess the situation', 'Call emergency services if needed', 'Provide assistance if safe']
    };
    return map[type] || map.other;
}

function getVerificationText(priority, confidence) {
    if (priority === 'critical') return '🔴 Urgent: dispatch responders immediately';
    if (priority === 'high') return '🟠 High priority: verify within 5 minutes';
    if (priority === 'medium') return '🟡 Schedule verification within 10–15 minutes';
    return '🟢 Low priority: routine follow-up';
}

async function analyzeAlertWithAI() {
    const typeSelect = document.getElementById('alertType');
    const type = typeSelect.value;
    const title = document.getElementById('alertTitle').value.trim();
    const desc = document.getElementById('alertMessage').value.trim();
    const loc = document.getElementById('alertLocation').value.trim();

    if (!desc && !title) { showToast('Please enter a title or message first', 'warning'); return; }

    const resultDiv = document.getElementById('alertAiAnalysisResult');
    resultDiv.classList.remove('d-none');
    document.getElementById('alertAiPriorityBadge').textContent = 'Analyzing…';
    document.getElementById('alertAiPriorityBadge').className = 'ai-badge bg-secondary text-white';
    document.getElementById('alertAiConfidenceBadge').textContent = 'Please wait…';
    document.getElementById('alertAiActionsList').innerHTML = '';
    document.getElementById('alertAiVerifyText').textContent = '';

    let result;
    try {
        if (geminiReady) result = await analyzeWithGemini(type, title, desc, loc);
        else {
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
        const hint = document.getElementById('autoAlertTypeHint');
        if (hint) {
            hint.textContent = `✨ Auto-detected: ${result.detectedType}`;
            hint.style.color = 'var(--primary)';
            setTimeout(() => { hint.textContent = ''; }, 8000);
        }
    }
    renderAlertAIAnalysisResult(result);
}

function renderAlertAIAnalysisResult(result) {
    const resultDiv = document.getElementById('alertAiAnalysisResult');
    const priorityBadge = document.getElementById('alertAiPriorityBadge');
    const confidenceBadge = document.getElementById('alertAiConfidenceBadge');
    const actionsList = document.getElementById('alertAiActionsList');
    const verifyText = document.getElementById('alertAiVerifyText');
    const colors = { critical: 'danger', high: 'warning', medium: 'primary', low: 'secondary' };
    priorityBadge.textContent = `Priority: ${result.priority.toUpperCase()}`;
    priorityBadge.className = `ai-badge bg-${colors[result.priority] || 'secondary'} text-white`;
    confidenceBadge.textContent = `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
    actionsList.innerHTML = '<i class="fas fa-tasks me-1"></i> ' + result.actions.join(' · ');
    verifyText.textContent = result.verification;
    resultDiv.style.borderLeftColor =
        result.priority === 'critical' ? '#dc3545' :
        result.priority === 'high' ? '#fd7e14' :
        result.priority === 'medium' ? '#0d6efd' : '#6c757d';
    window._alertAiResult = result;
    showToast(
        `AI: ${result.priority.toUpperCase()} (${(result.confidence * 100).toFixed(0)}%)` + (result.detectedType ? ` — Type: ${result.detectedType}` : ''),
        result.priority === 'critical' ? 'danger' : result.priority === 'high' ? 'warning' : 'info',
        4000
    );
}

async function analyzeWithGeminiFallback(type, title, desc, loc) {
    if (geminiReady) {
        try { return await analyzeWithGemini(type, title, desc, loc); }
        catch (e) { console.warn('Gemini failed during submit:', e); }
    }
    const detected = detectIncidentType(title, desc);
    const result = enhancedAIAnalysis(detected.type, desc, loc, title);
    result.detectedType = detected.type;
    return result;
}

// ============================================
// SEND ALERT (ADMIN ONLY)
// Notifies BOTH residents and responders
// ============================================
async function sendAlert() {
    if (!currentProfile || currentProfile.role !== 'admin') {
        showToast('Access denied. Admins only.', 'warning', 4000);
        return;
    }

    const type = document.getElementById('alertType').value;
    const title = document.getElementById('alertTitle').value.trim();
    const message = document.getElementById('alertMessage').value.trim();
    const location = document.getElementById('alertLocation').value.trim();
    const contact = document.getElementById('alertContact').value.trim();
    const lat = document.getElementById('alertLat').value;
    const lng = document.getElementById('alertLng').value;

    if (!title || !message || !location || !contact) { showToast('Please fill in all fields', 'warning'); return; }
    if (!lat || !lng) { showToast('Please select a location on the map or search for a place', 'warning'); return; }

    let aiResult = window._alertAiResult;
    if (!aiResult) {
        aiResult = await analyzeWithGeminiFallback(type, title, message, location);
        window._alertAiResult = aiResult;
    }

    const btn = document.getElementById('sendAlertBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...'; }

    try {
        const locationObj = { address: location, latitude: parseFloat(lat), longitude: parseFloat(lng) };

        // 1. Fetch recipients (residents + responders + admins, excluding sender)
        let recipients = [];
        try {
            const recipientsResult = await supabaseClient.from('profiles').select('id, full_name, email, role')
                .in('role', ['resident', 'responder', 'admin']);
            recipients = recipientsResult.data || [];
        } catch (e) { console.warn('Fetch recipients failed:', e); }

        const senderId = currentUser ? currentUser.id : null;
        const targetRecipients = recipients.filter(r => r.id !== senderId);
        const residentCount = targetRecipients.filter(r => r.role === 'resident').length;
        const responderCount = targetRecipients.filter(r => r.role === 'responder').length;

        // 2. Insert alert row
        const alertPayload = {
            title: title, message: message, type: type, priority: aiResult.priority,
            status: 'sent', location: JSON.stringify(locationObj), contact_number: contact,
            barangay: currentProfile?.barangay || null, recipients_count: targetRecipients.length,
            sent_by: currentUser.id, sent_at: new Date().toISOString(),
            ai_analysis: {
                priority: aiResult.priority, confidence: aiResult.confidence,
                actions: aiResult.actions, verification: aiResult.verification,
                source: aiResult.source || 'rule-based', reasoning: aiResult.reasoning || [],
                detectedLanguage: aiResult.detectedLanguage || 'unknown',
                detectedType: aiResult.detectedType || type
            },
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };

        const insertResult = await supabaseClient.from('alerts').insert([alertPayload]).select().single();
        if (insertResult.error) throw insertResult.error;
        const alertData = insertResult.data;
        console.log('✅ Alert inserted:', alertData.id);

        // 3. Upload media
        let mediaUrls = [];
        if (selectedAlertMediaFiles.length > 0) {
            showToast('📤 Uploading media files...', 'info', 3000);
            mediaUrls = await uploadAlertMediaFiles(alertData.id);
            if (mediaUrls.length > 0) {
                const { error: updateError } = await supabaseClient.from('alerts')
                    .update({ media_urls: JSON.stringify(mediaUrls), updated_at: new Date().toISOString() })
                    .eq('id', alertData.id);
                if (updateError) showToast('Alert saved but media upload failed', 'warning');
                else showToast(`✅ ${mediaUrls.length} attachment(s) uploaded!`, 'success');
            }
        }

        // 4. Create in-app notifications for BOTH residents and responders
        if (targetRecipients.length > 0) {
            const notificationsPayload = targetRecipients.map(function(recipient) {
                return {
                    user_id: recipient.id,
                    title: '🚨 ' + title,
                    message: message,
                    type: 'alert',
                    priority: aiResult.priority,
                    read: false,
                    data: {
                        alert_id: alertData.id, alert_type: type,
                        location: locationObj, media_urls: mediaUrls,
                        ai_priority: aiResult.priority, ai_confidence: aiResult.confidence
                    },
                    created_at: new Date().toISOString()
                };
            });
            const CHUNK_SIZE = 100;
            for (let i = 0; i < notificationsPayload.length; i += CHUNK_SIZE) {
                const chunk = notificationsPayload.slice(i, i + CHUNK_SIZE);
                const notifResult = await supabaseClient.from('notifications').insert(chunk);
                if (notifResult.error) console.warn('Notification insert error:', notifResult.error);
            }
            console.log('📬 Notifications sent to ' + targetRecipients.length + ' users');
        }

        // 5. Email notifications
        try {
            if (typeof window.sendEmergencyEmailNotification === 'function') {
                const result = await window.sendEmergencyEmailNotification(alertData, false);
                if (result && result.success) showToast('📧 Email notifications sent!', 'success', 5000);
            }
        } catch (emailError) { console.error('Email notification error:', emailError); }

        showToast(
            '✅ Alert sent to ' + residentCount + ' residents' +
            (responderCount > 0 ? ' and ' + responderCount + ' responders' : '') + '!',
            'success', 6000
        );

        if (alertModal) alertModal.hide();
        resetAlertForm();
        loadAlerts();
    } catch (error) {
        console.error('Send alert error:', error);
        showToast('Failed to send alert: ' + error.message, 'danger');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Alert'; }
    }
}

// ============================================
// ANALYTICS
// ============================================
async function loadAnalytics() {
    var container = document.getElementById('pageContent');
    if (!container) return;
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;
        var now = Date.now();
        var rangeMs = analyticsRange * 24 * 60 * 60 * 1000;
        var inRange = reports.filter(function(r) { return r.created_at && (now - new Date(r.created_at).getTime()) <= rangeMs; });
        var total = inRange.length;
        var critical = inRange.filter(function(r) { return r.priority === 'critical'; }).length;
        var resolved = inRange.filter(function(r) { return r.status === 'resolved'; }).length;
        var avgResponse = computeAvgResponseMinutes(inRange);
        var prevStart = now - rangeMs * 2, prevEnd = now - rangeMs;
        var prevInRange = reports.filter(function(r) {
            if (!r.created_at) return false;
            var t = new Date(r.created_at).getTime();
            return t >= prevStart && t < prevEnd;
        });
        var totalTrend = computeTrend(total, prevInRange.length);
        var criticalTrend = computeTrend(critical, prevInRange.filter(function(r) { return r.priority === 'critical'; }).length);

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
                <div>
                    <h4 class="fw-bold"><i class="fas fa-chart-line me-2"></i>Analytics</h4>
                    <p class="text-muted mb-0">Historical incident trends for Barangay ${escapeHtml(currentProfile?.barangay || 'N/A')}</p>
                </div>
                <div class="chart-filter-group" id="analyticsRangeFilter">
                    <button class="chart-filter-btn ${analyticsRange === 7 ? 'active' : ''}" data-range="7">7D</button>
                    <button class="chart-filter-btn ${analyticsRange === 30 ? 'active' : ''}" data-range="30">30D</button>
                    <button class="chart-filter-btn ${analyticsRange === 90 ? 'active' : ''}" data-range="90">90D</button>
                    <button class="chart-filter-btn ${analyticsRange === 365 ? 'active' : ''}" data-range="365">1Y</button>
                </div>
            </div>

            <div class="analytics-kpi-strip">
                <div class="analytics-kpi"><div class="kpi-label">Total Incidents</div><div class="kpi-value">${total}</div><div class="kpi-trend ${totalTrend.cls}"><i class="fas fa-${totalTrend.icon}"></i>${totalTrend.text}</div></div>
                <div class="analytics-kpi"><div class="kpi-label">Critical</div><div class="kpi-value" style="color:var(--destructive);">${critical}</div><div class="kpi-trend ${criticalTrend.cls}"><i class="fas fa-${criticalTrend.icon}"></i>${criticalTrend.text}</div></div>
                <div class="analytics-kpi"><div class="kpi-label">Resolved</div><div class="kpi-value" style="color:var(--primary);">${resolved}</div><div class="kpi-trend flat"><i class="fas fa-check"></i>${total > 0 ? Math.round((resolved / total) * 100) : 0}% resolution</div></div>
                <div class="analytics-kpi"><div class="kpi-label">Avg. Response</div><div class="kpi-value">${avgResponse > 0 ? avgResponse.toFixed(1) + 'm' : '—'}</div><div class="kpi-trend flat"><i class="fas fa-clock"></i>report → ack</div></div>
            </div>

            <div class="analytics-grid">
                <div class="chart-card">
                    <div class="chart-card-header"><h6><i class="fas fa-chart-area"></i>Incident Trend Over Time</h6><span class="text-muted small"><span class="chart-live-dot"></span>Live</span></div>
                    <div class="chart-card-body"><div class="chart-canvas-wrap"><canvas id="trendChart"></canvas></div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-card-header"><h6><i class="fas fa-chart-pie"></i>Incidents by Type</h6></div>
                    <div class="chart-card-body"><div class="chart-canvas-wrap"><canvas id="typeChart"></canvas></div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-card-header"><h6><i class="fas fa-chart-bar"></i>Incidents by Priority</h6></div>
                    <div class="chart-card-body"><div class="chart-canvas-wrap"><canvas id="priorityChart"></canvas></div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-card-header"><h6><i class="fas fa-chart-line"></i>Status Distribution</h6></div>
                    <div class="chart-card-body"><div class="chart-canvas-wrap"><canvas id="statusChart"></canvas></div></div>
                </div>
                <div class="chart-card" style="grid-column: 1 / -1;">
                    <div class="chart-card-header"><h6><i class="fas fa-clock"></i>Hourly Incident Pattern</h6></div>
                    <div class="chart-card-body"><div class="chart-canvas-wrap" style="height:220px;"><canvas id="hourlyChart"></canvas></div></div>
                </div>
            </div>
        `;

        document.querySelectorAll('#analyticsRangeFilter .chart-filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('#analyticsRangeFilter .chart-filter-btn').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                analyticsRange = parseInt(this.dataset.range, 10);
                loadAnalytics();
            });
        });
        setTimeout(function() { renderAnalyticsCharts(inRange); }, 50);
        if (analyticsRefreshTimer) clearInterval(analyticsRefreshTimer);
        analyticsRefreshTimer = setInterval(function() {
            var activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
            if (activePage === 'analytics') refreshAnalyticsDataInPlace();
            else { clearInterval(analyticsRefreshTimer); analyticsRefreshTimer = null; }
        }, 15000);
    } catch (error) {
        console.error('Analytics error:', error);
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>Error loading analytics</div>';
    }
}

function computeAvgResponseMinutes(reports) {
    var times = [];
    reports.forEach(function(r) {
        if (r.created_at && r.acknowledged_at) {
            var diff = (new Date(r.acknowledged_at).getTime() - new Date(r.created_at).getTime()) / 60000;
            if (diff > 0 && diff < 60 * 24 * 7) times.push(diff);
        }
    });
    if (times.length === 0) return 0;
    return times.reduce(function(a, b) { return a + b; }, 0) / times.length;
}

function computeTrend(current, previous) {
    if (previous === 0 && current === 0) return { cls: 'flat', icon: 'minus', text: 'No change' };
    if (previous === 0) return { cls: 'up', icon: 'arrow-up', text: '+' + current + ' new' };
    var pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < 5) return { cls: 'flat', icon: 'minus', text: 'Stable' };
    if (pct > 0) return { cls: 'up', icon: 'arrow-up', text: '+' + pct.toFixed(0) + '% vs prev' };
    return { cls: 'down', icon: 'arrow-down', text: pct.toFixed(0) + '% vs prev' };
}

async function refreshAnalyticsDataInPlace() {
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;
        var now = Date.now();
        var rangeMs = analyticsRange * 24 * 60 * 60 * 1000;
        var inRange = reports.filter(function(r) { return r.created_at && (now - new Date(r.created_at).getTime()) <= rangeMs; });
        if (analyticsCharts.trend) updateTrendChart(analyticsCharts.trend, inRange, analyticsRange);
        if (analyticsCharts.type) updateTypeChart(analyticsCharts.type, inRange);
        if (analyticsCharts.priority) updatePriorityChart(analyticsCharts.priority, inRange);
        if (analyticsCharts.status) updateStatusChart(analyticsCharts.status, inRange);
        if (analyticsCharts.hourly) updateHourlyChart(analyticsCharts.hourly, inRange);
    } catch (e) { console.warn('Analytics refresh failed', e); }
}

function destroyAllCharts() {
    Object.keys(analyticsCharts).forEach(function(k) { try { analyticsCharts[k].destroy(); } catch (e) {} });
    analyticsCharts = {};
    if (analyticsRefreshTimer) { clearInterval(analyticsRefreshTimer); analyticsRefreshTimer = null; }
}

function getChartThemeColors() {
    var styles = getComputedStyle(document.documentElement);
    var isDark = document.documentElement.classList.contains('dark');
    return {
        text: styles.getPropertyValue('--foreground').trim() || (isDark ? '#fff' : '#000'),
        muted: styles.getPropertyValue('--muted-foreground').trim() || '#888',
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        primary: styles.getPropertyValue('--primary').trim() || '#2e7d32',
        destructive: styles.getPropertyValue('--destructive').trim() || '#dc3545',
        priCritical: '#dc3545', priHigh: '#fd7e14', priMedium: '#ffc107', priLow: '#0d6efd',
        typeFire: '#dc3545', typeMedical: '#0d6efd', typeAccident: '#fd7e14',
        typeFlood: '#0dcaf0', typeCrime: '#8b5cf6', typeOther: '#6c757d'
    };
}

function renderAnalyticsCharts(reports) {
    if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
    var C = getChartThemeColors();
    Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";
    Chart.defaults.color = C.text;

    var trendCtx = document.getElementById('trendChart');
    if (trendCtx) {
        var trendData = buildTrendData(reports, analyticsRange);
        analyticsCharts.trend = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: trendData.labels,
                datasets: [
                    { label: 'All Incidents', data: trendData.all, borderColor: C.primary, backgroundColor: hexToRgba(C.primary, 0.15), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
                    { label: 'Critical', data: trendData.critical, borderColor: C.destructive, backgroundColor: hexToRgba(C.destructive, 0.12), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 }
                ]
            },
            options: buildLineOptions(C)
        });
    }
    var typeCtx = document.getElementById('typeChart');
    if (typeCtx) {
        var typeData = countByType(reports);
        analyticsCharts.type = new Chart(typeCtx, {
            type: 'doughnut',
            data: { labels: typeData.labels, datasets: [{ data: typeData.values, backgroundColor: typeData.colors, borderColor: C.muted, borderWidth: 2, hoverOffset: 8 }] },
            options: buildDoughnutOptions(C)
        });
    }
    var priCtx = document.getElementById('priorityChart');
    if (priCtx) {
        var priData = countByPriority(reports);
        analyticsCharts.priority = new Chart(priCtx, {
            type: 'bar',
            data: { labels: priData.labels, datasets: [{ label: 'Incidents', data: priData.values, backgroundColor: priData.colors, borderRadius: 8, borderSkipped: false, barThickness: 40 }] },
            options: buildBarOptions(C)
        });
    }
    var statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
        var statusData = countByStatus(reports);
        analyticsCharts.status = new Chart(statusCtx, {
            type: 'polarArea',
            data: { labels: statusData.labels, datasets: [{ data: statusData.values, backgroundColor: statusData.colors.map(function(c) { return hexToRgba(c, 0.7); }), borderColor: statusData.colors, borderWidth: 2 }] },
            options: buildPolarOptions(C)
        });
    }
    var hourCtx = document.getElementById('hourlyChart');
    if (hourCtx) {
        var hourData = countByHour(reports);
        analyticsCharts.hourly = new Chart(hourCtx, {
            type: 'bar',
            data: { labels: hourData.labels, datasets: [{ label: 'Incidents', data: hourData.values, backgroundColor: hexToRgba(C.primary, 0.75), borderRadius: 5, borderSkipped: false }] },
            options: buildBarOptions(C)
        });
    }
}

function updateTrendChart(chart, reports, range) {
    var d = buildTrendData(reports, range);
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.all;
    chart.data.datasets[1].data = d.critical;
    chart.update('none');
}
function updateTypeChart(chart, reports) {
    var d = countByType(reports);
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.values;
    chart.data.datasets[0].backgroundColor = d.colors;
    chart.update('none');
}
function updatePriorityChart(chart, reports) {
    var d = countByPriority(reports);
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.values;
    chart.data.datasets[0].backgroundColor = d.colors;
    chart.update('none');
}
function updateStatusChart(chart, reports) {
    var d = countByStatus(reports);
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.values;
    chart.data.datasets[0].backgroundColor = d.colors.map(function(c) { return hexToRgba(c, 0.7); });
    chart.data.datasets[0].borderColor = d.colors;
    chart.update('none');
}
function updateHourlyChart(chart, reports) {
    var d = countByHour(reports);
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.values;
    chart.update('none');
}

function buildTrendData(reports, days) {
    var labels = [], all = [], critical = [];
    var bucketCount = days <= 7 ? days : (days <= 30 ? days : (days <= 90 ? Math.ceil(days / 3) : 12));
    var bucketSize = days <= 30 ? 1 : (days <= 90 ? 3 : Math.ceil(days / 12));
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var buckets = [];
    for (var i = bucketCount - 1; i >= 0; i--) {
        var start = new Date(now);
        start.setDate(start.getDate() - (i * bucketSize + bucketSize - 1));
        var end = new Date(start);
        end.setDate(end.getDate() + bucketSize);
        buckets.push({ start: start.getTime(), end: end.getTime() });
        var label;
        if (days <= 7) label = start.toLocaleDateString('en-US', { weekday: 'short' });
        else if (days <= 90) label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        else label = start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        labels.push(label);
    }
    buckets.forEach(function(b) {
        var inBucket = reports.filter(function(r) {
            if (!r.created_at) return false;
            var t = new Date(r.created_at).getTime();
            return t >= b.start && t < b.end;
        });
        all.push(inBucket.length);
        critical.push(inBucket.filter(function(r) { return r.priority === 'critical'; }).length);
    });
    return { labels: labels, all: all, critical: critical };
}

function countByType(reports) {
    var C = getChartThemeColors();
    var types = ['fire', 'medical', 'accident', 'flood', 'crime', 'other'];
    var colors = [C.typeFire, C.typeMedical, C.typeAccident, C.typeFlood, C.typeCrime, C.typeOther];
    var values = types.map(function(t) { return reports.filter(function(r) { return (r.type || 'other') === t; }).length; });
    var fl = [], fv = [], fc = [];
    types.forEach(function(t, i) { if (values[i] > 0) { fl.push(t.charAt(0).toUpperCase() + t.slice(1)); fv.push(values[i]); fc.push(colors[i]); } });
    if (fl.length === 0) return { labels: ['No data'], values: [0], colors: [C.muted] };
    return { labels: fl, values: fv, colors: fc };
}

function countByPriority(reports) {
    var C = getChartThemeColors();
    var pris = ['critical', 'high', 'medium', 'low'];
    var colors = [C.priCritical, C.priHigh, C.priMedium, C.priLow];
    var values = pris.map(function(p) { return reports.filter(function(r) { return (r.priority || 'medium') === p; }).length; });
    return { labels: ['Critical', 'High', 'Medium', 'Low'], values: values, colors: colors };
}

function countByStatus(reports) {
    var C = getChartThemeColors();
    var statuses = ['reported', 'acknowledged', 'responding', 'resolved', 'closed'];
    var colors = ['#dc3545', '#0d6efd', '#fd7e14', C.primary, '#6c757d'];
    var values = statuses.map(function(s) { return reports.filter(function(r) { return (r.status || 'reported') === s; }).length; });
    var fl = [], fv = [], fc = [];
    statuses.forEach(function(s, i) { if (values[i] > 0) { fl.push(s.charAt(0).toUpperCase() + s.slice(1)); fv.push(values[i]); fc.push(colors[i]); } });
    if (fl.length === 0) return { labels: ['No data'], values: [0], colors: [C.muted] };
    return { labels: fl, values: fv, colors: fc };
}

function countByHour(reports) {
    var labels = [], values = [];
    for (var h = 0; h < 24; h++) {
        labels.push((h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p'));
        values.push(0);
    }
    reports.forEach(function(r) { if (!r.created_at) return; var h = new Date(r.created_at).getHours(); values[h]++; });
    return { labels: labels, values: values };
}

function buildLineOptions(C) {
    return {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle', color: C.muted, font: { size: 11, weight: '600' }, padding: 14 } },
            tooltip: { backgroundColor: C.text, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 }
        },
        scales: {
            x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 } } },
            y: { beginAtZero: true, grid: { color: C.grid, drawBorder: false }, ticks: { color: C.muted, font: { size: 10 }, precision: 0, stepSize: 1 } }
        }
    };
}
function buildBarOptions(C) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: C.text, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 } },
        scales: {
            x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 } } },
            y: { beginAtZero: true, grid: { color: C.grid, drawBorder: false }, ticks: { color: C.muted, font: { size: 10 }, precision: 0, stepSize: 1 } }
        }
    };
}
function buildDoughnutOptions(C) {
    return {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle', color: C.muted, font: { size: 11, weight: '600' }, padding: 12 } },
            tooltip: { backgroundColor: C.text, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 }
        }
    };
}
function buildPolarOptions(C) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle', color: C.muted, font: { size: 11, weight: '600' }, padding: 12 } },
            tooltip: { backgroundColor: C.text, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 8 }
        },
        scales: { r: { grid: { color: C.grid }, ticks: { color: C.muted, backdropColor: 'transparent', font: { size: 10 }, precision: 0 } } }
    };
}

function hexToRgba(color, alpha) {
    if (!color) return 'rgba(46,125,50,' + alpha + ')';
    color = color.trim();
    if (color.startsWith('#')) {
        var hex = color.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
        return 'rgba(' + parseInt(hex.substring(0, 2), 16) + ',' + parseInt(hex.substring(2, 4), 16) + ',' + parseInt(hex.substring(4, 6), 16) + ',' + alpha + ')';
    }
    if (color.startsWith('rgb')) {
        return color.replace(/rgba?\(([^)]+)\)/, function(m, inner) {
            var parts = inner.split(',').map(function(s) { return s.trim(); });
            return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + alpha + ')';
        });
    }
    return 'rgba(46,125,50,' + alpha + ')';
}

// ============================================
// INCIDENTS PAGE
// ============================================
async function loadIncidents() {
    var container = document.getElementById('pageContent');
    if (!container) return;
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;
        var total = reports.length;
        var active = reports.filter(function(r) { return !['resolved', 'closed'].includes(r.status); }).length;
        var critical = reports.filter(function(r) { return r.priority === 'critical' && !['resolved', 'closed'].includes(r.status); }).length;
        var resolved = reports.filter(function(r) { return ['resolved', 'closed'].includes(r.status); }).length;

        container.innerHTML = `
            <div class="incidents-header">
                <div class="d-flex justify-content-between align-items-start flex-wrap gap-3">
                    <div>
                        <h4><i class="fas fa-list me-2"></i>All Incidents</h4>
                        <p>Complete incident reports from your barangay</p>
                    </div>
                </div>
                <div class="d-flex gap-3 mt-3 flex-wrap">
                    <div class="incidents-stat-pill"><div class="num">${total}</div><div class="lbl">Total</div></div>
                    <div class="incidents-stat-pill"><div class="num text-warning">${active}</div><div class="lbl">Active</div></div>
                    <div class="incidents-stat-pill"><div class="num text-danger">${critical}</div><div class="lbl">Critical</div></div>
                    <div class="incidents-stat-pill"><div class="num text-success">${resolved}</div><div class="lbl">Resolved</div></div>
                </div>
            </div>

            ${reports && reports.length > 0 ? `
                <div class="incidents-filter-bar">
                    <div class="row g-2 align-items-center">
                        <div class="col-md-5">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text bg-white"><i class="fas fa-search text-muted"></i></span>
                                <input type="text" class="form-control" id="incidentSearchInput" placeholder="Search incidents..." oninput="filterIncidents()">
                            </div>
                        </div>
                        <div class="col-md-3">
                            <select class="form-select form-select-sm" id="incidentStatusFilter" onchange="filterIncidents()">
                                <option value="">All Statuses</option>
                                <option value="reported">Reported</option>
                                <option value="acknowledged">Acknowledged</option>
                                <option value="responding">Responding</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <select class="form-select form-select-sm" id="incidentPriorityFilter" onchange="filterIncidents()">
                                <option value="">All Priorities</option>
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        <div class="col-md-1 text-end">
                            <button class="btn btn-sm btn-outline-secondary w-100" onclick="resetIncidentFilters()" title="Reset filters">
                                <i class="fas fa-redo"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div id="incidentsListContainer">
                    ${reports.map(function(incident) { return renderIncidentCard(incident); }).join('')}
                </div>
                <div id="noFilterResults" class="incident-empty-state" style="display:none;">
                    <i class="fas fa-search"></i>
                    <h5>No incidents match your filters</h5>
                    <p>Try adjusting your search or filter criteria.</p>
                </div>
            ` : `
                <div class="incident-empty-state">
                    <i class="fas fa-check-circle"></i>
                    <h5>No incidents reported</h5>
                    <p>There are currently no incident reports in the system.</p>
                </div>
            `}

            <div class="modal fade" id="incidentDetailModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content" style="border-radius:16px;border:none;">
                        <div class="modal-header" style="border-bottom:1px solid #f0f2f5;padding:20px 24px;">
                            <h5 class="modal-title fw-bold" id="incidentDetailModalTitle">
                                <i class="fas fa-file-alt me-2 text-primary"></i>Incident Details
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="incidentDetailModalBody" style="padding:24px;"></div>
                        <div class="modal-footer" id="incidentDetailModalFooter" style="border-top:1px solid #f0f2f5;padding:16px 24px;"></div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading incidents:', error);
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>Error loading incidents. Please try again.</div>';
    }
}

function renderIncidentCard(incident) {
    var mediaUrls = getMediaUrls(incident);
    var mediaUrlsJson = JSON.stringify(mediaUrls).replace(/"/g, '&quot;');
    var rawDescription = (incident.description === null || incident.description === undefined) ? '' : String(incident.description).trim();
    var hasDescription = rawDescription.length > 0;
    var escapedDescription = escapeHtml(rawDescription);
    var typeIcon = getTypeIcon(incident.type);
    var typeClass = getTypeClass(incident.type);
    var priority = incident.priority || 'medium';
    var status = incident.status || 'reported';
    var createdDate = formatDateTime(incident.created_at);
    var pulse = getPriorityPulseClasses(priority);
    var isLongDescription = rawDescription.length > 180;
    var safeSearch = (incident.title + ' ' + incident.type + ' ' + (incident.location || '') + ' ' + rawDescription)
        .toLowerCase().replace(/"/g, '').replace(/'/g, '');
    var descHtml = hasDescription
        ? `<div class="incident-description-box ${isLongDescription ? 'clamped' : ''}" id="desc-${incident.id}"><span class="desc-label"><i class="fas fa-align-left me-1"></i>Description</span><span class="desc-text">${escapedDescription}</span></div>`
        : `<div class="incident-no-desc"><i class="fas fa-info-circle"></i>No description provided by reporter</div>`;

    return `
        <div class="incident-card priority-${priority} bg-transparent ${pulse.card}" data-incident-id="${incident.id}"
             data-search="${safeSearch}" data-status="${status}" data-priority="${priority}">
            <div class="incident-card-header">
                <div class="d-flex align-items-start gap-3 flex-grow-1" style="min-width:0;">
                    <div class="incident-type-icon ${typeClass} ${pulse.icon}"><i class="fas ${typeIcon}"></i></div>
                    <div style="min-width:0;flex:1;">
                        <div class="incident-card-title"><span style="word-break:break-word;">${escapeHtml(incident.title) || 'Untitled Incident'}</span></div>
                        <div class="incident-card-meta">
                            <span><i class="fas fa-tag"></i>${escapeHtml(incident.type) || 'Unknown'}</span>
                            <span><i class="fas fa-map-marker-alt"></i>${escapeHtml(formatLocationForPopup(incident.location))}</span>
                            <span><i class="fas fa-clock"></i>${createdDate}</span>
                        </div>
                    </div>
                </div>
                <div class="d-flex flex-column align-items-end gap-2 flex-shrink-0">
                    <span class="badge priority-${priority}">${priority}</span>
                    <span class="status-badge status-${status}">${status}</span>
                </div>
            </div>
            <div class="incident-card-body">
                ${descHtml}
                ${mediaUrls.length > 0 ? `<div class="d-flex align-items-center gap-2 mt-2"><span class="media-badge" onclick="viewIncidentMedia('${mediaUrlsJson.replace(/'/g, "&#39;")}')"><i class="fas fa-paperclip"></i>${mediaUrls.length} attachment${mediaUrls.length > 1 ? 's' : ''}</span></div>` : ''}
            </div>
            <div class="incident-card-footer">
                <div class="small" style="color:var(--muted-foreground);"><i class="fas fa-hashtag me-1"></i>ID: ${incident.id.substring(0, 8)}...</div>
                <div class="incident-action-group d-flex gap-2 flex-wrap">
                    ${isLongDescription ? `<button class="btn-incident-action btn-outline-secondary" onclick="toggleIncidentDescription('${incident.id}', this)"><i class="fas fa-chevron-down"></i>Read More</button>` : ''}
                    <button class="btn-incident-action btn-outline-primary" onclick="viewIncidentDetails('${incident.id}')"><i class="fas fa-eye"></i>View Full Details</button>
                    <button class="btn-incident-action btn-primary" onclick="openActionModal('${incident.id}')"><i class="fas fa-edit"></i>Update</button>
                </div>
            </div>
        </div>
    `;
}

function refreshIncidentsListInPlace() {
    var listContainer = document.getElementById('incidentsListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = allIncidents.map(function(incident) { return renderIncidentCard(incident); }).join('');
    if (typeof filterIncidents === 'function') filterIncidents();
}

function toggleIncidentDescription(incidentId, btn) {
    var descBox = document.getElementById('desc-' + incidentId);
    if (!descBox) return;
    var incident = allIncidents.find(function(i) { return i.id === incidentId; });
    if (!incident) return;
    var rawDescription = (incident.description == null) ? '' : String(incident.description).trim();
    var escaped = escapeHtml(rawDescription);
    var isClamped = descBox.classList.contains('clamped');
    var textSpan = descBox.querySelector('.desc-text');
    if (!textSpan) return;
    if (isClamped) {
        descBox.classList.remove('clamped');
        textSpan.innerHTML = escaped;
        btn.innerHTML = '<i class="fas fa-chevron-up"></i>Show Less';
    } else {
        descBox.classList.add('clamped');
        textSpan.innerHTML = escaped;
        btn.innerHTML = '<i class="fas fa-chevron-down"></i>Read More';
    }
}

async function viewIncidentDetails(incidentId) {
    var incident = null;
    try {
        var freshRes = await supabaseClient.from('incident_reports').select('*').eq('id', incidentId).maybeSingle();
        if (freshRes.data) {
            incident = freshRes.data;
            var idx = allIncidents.findIndex(function(i) { return i.id === incidentId; });
            if (idx >= 0) allIncidents[idx] = incident;
        }
    } catch (e) {}
    if (!incident) incident = allIncidents.find(function(i) { return i.id === incidentId; });
    if (!incident) { showToast('Incident not found', 'warning'); return; }

    var mediaUrls = getMediaUrls(incident);
    var typeIcon = getTypeIcon(incident.type);
    var priority = incident.priority || 'medium';
    var status = incident.status || 'reported';
    var reporterName = 'Unknown Reporter';
    if (incident.reporter_id) {
        try {
            var profResult = await supabaseClient.from('profiles').select('full_name').eq('id', incident.reporter_id).maybeSingle();
            if (profResult.data) reporterName = profResult.data.full_name || 'Unknown';
        } catch (e) {}
    }
    var createdDate = incident.created_at ? new Date(incident.created_at).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';

    var modalTitle = document.getElementById('incidentDetailModalTitle');
    var modalBody = document.getElementById('incidentDetailModalBody');
    var modalFooter = document.getElementById('incidentDetailModalFooter');
    if (!modalTitle || !modalBody || !modalFooter) return;

    var rawDescription = (incident.description == null) ? '' : String(incident.description).trim();
    var escapedDescription = escapeHtml(rawDescription);
    var descBlock = rawDescription.length > 0 ? `<div class="incident-modal-description">${escapedDescription}</div>` : `<div class="incident-no-desc"><i class="fas fa-info-circle"></i>No description provided by reporter</div>`;

    modalTitle.innerHTML = '<i class="fas ' + typeIcon + ' me-2 text-primary"></i>' + escapeHtml(incident.title || 'Incident Details');

    modalBody.innerHTML = `
        <div class="d-flex gap-2 mb-4 flex-wrap">
            <span class="badge priority-${priority}" style="font-size:0.75rem;padding:7px 18px;border-radius:50px;font-weight:700;text-transform:uppercase;"><i class="fas fa-exclamation-triangle me-1"></i>${priority} Priority</span>
            <span class="status-badge status-${status}" style="font-size:0.75rem;padding:7px 18px;"><i class="fas fa-circle me-1" style="font-size:0.5rem;"></i>${status}</span>
        </div>
        <div class="incident-modal-meta-grid mb-4">
            <div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-tag me-1"></i>Type</div><div class="val text-capitalize">${escapeHtml(incident.type) || 'Unknown'}</div></div>
            <div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-map-marker-alt me-1"></i>Location</div><div class="val">${escapeHtml(formatLocationForPopup(incident.location))}</div></div>
            <div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-user me-1"></i>Reporter</div><div class="val">${escapeHtml(reporterName)}</div></div>
            <div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-clock me-1"></i>Reported</div><div class="val" style="font-size:0.82rem;">${createdDate}</div></div>
            ${incident.barangay ? `<div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-building me-1"></i>Barangay</div><div class="val">${escapeHtml(incident.barangay)}</div></div>` : ''}
            ${incident.contact_number ? `<div class="incident-modal-meta-item"><div class="lbl"><i class="fas fa-phone me-1"></i>Contact</div><div class="val">${escapeHtml(incident.contact_number)}</div></div>` : ''}
        </div>
        <div class="mb-2"><label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;"><i class="fas fa-align-left me-1"></i>Full Description</label></div>
        ${descBlock}
        ${mediaUrls.length > 0 ? `
            <div class="mb-2 mt-4"><label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;"><i class="fas fa-paperclip me-1"></i>Attachments (${mediaUrls.length})</label></div>
            <div class="d-flex flex-wrap gap-2">
                ${mediaUrls.map(function(m) {
                    var isVideo = m.type === 'video';
                    return `<div class="popup-media-item" style="width:90px;height:90px;" onclick="openLightbox('${m.url}', '${isVideo ? 'video' : 'image'}')">${isVideo ? '<video src="' + m.url + '" muted></video><div class="play-overlay"><i class="fas fa-play"></i></div>' : '<img src="' + m.url + '" alt="Attachment" onerror="this.style.display=\'none\'">'}</div>`;
                }).join('')}
            </div>
        ` : ''}
    `;

    modalFooter.innerHTML = `
        <button class="btn btn-secondary" data-bs-dismiss="modal"><i class="fas fa-times me-1"></i>Close</button>
        <button class="btn btn-primary" onclick="closeIncidentDetailModalAndAction('${incident.id}')"><i class="fas fa-edit me-1"></i>Update Incident</button>
    `;

    var modalEl = document.getElementById('incidentDetailModal');
    var existingModal = bootstrap.Modal.getInstance(modalEl);
    if (existingModal) existingModal.dispose();
    var modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function closeIncidentDetailModalAndAction(incidentId) {
    var modalEl = document.getElementById('incidentDetailModal');
    var modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    setTimeout(function() { openActionModal(incidentId); }, 300);
}

function filterIncidents() {
    var searchInput = document.getElementById('incidentSearchInput');
    var statusFilter = document.getElementById('incidentStatusFilter');
    var priorityFilter = document.getElementById('incidentPriorityFilter');
    var container = document.getElementById('incidentsListContainer');
    var noResults = document.getElementById('noFilterResults');
    if (!container) return;
    var search = (searchInput?.value || '').toLowerCase().trim();
    var status = statusFilter?.value || '';
    var priority = priorityFilter?.value || '';
    var cards = container.querySelectorAll('.incident-card');
    var visibleCount = 0;
    cards.forEach(function(card) {
        var cardSearch = card.getAttribute('data-search') || '';
        var cardStatus = card.getAttribute('data-status') || '';
        var cardPriority = card.getAttribute('data-priority') || '';
        var matchSearch = !search || cardSearch.indexOf(search) !== -1;
        var matchStatus = !status || cardStatus === status;
        var matchPriority = !priority || cardPriority === priority;
        if (matchSearch && matchStatus && matchPriority) { card.style.display = ''; visibleCount++; }
        else card.style.display = 'none';
    });
    if (noResults) noResults.style.display = visibleCount === 0 ? 'block' : 'none';
}

function resetIncidentFilters() {
    var s = document.getElementById('incidentSearchInput'); if (s) s.value = '';
    var st = document.getElementById('incidentStatusFilter'); if (st) st.value = '';
    var p = document.getElementById('incidentPriorityFilter'); if (p) p.value = '';
    filterIncidents();
}

// ============================================
// RESPONDERS (ADMIN ONLY)
// ============================================
async function loadResponders() {
    var container = document.getElementById('pageContent');
    if (!container) return;
    if (!currentProfile || currentProfile.role !== 'admin') {
        showToast('Access denied. Admins only.', 'warning', 4000);
        loadDashboard();
        return;
    }
    try {
        var respondersResult = await supabaseClient.from('profiles').select('*').in('role', ['responder', 'admin']).order('created_at', { ascending: false });
        var responders = respondersResult.data || [];

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h4 class="fw-bold"><i class="fas fa-users me-2"></i>Responders</h4>
                <button class="btn btn-danger d-inline-flex align-items-center gap-2" onclick="addResponderModal.show()">
                    <i class="fas fa-user-plus"></i>
                    <span>Add Responder</span>
                </button>
            </div>
            ${responders && responders.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead><tr><th>Name</th><th>Email</th><th>Barangay</th><th>Contact</th><th>Role</th><th>Status</th></tr></thead>
                        <tbody>
                            ${responders.map(function(r) {
                                return `<tr>
                                  <td><span class="responder-name">${escapeHtml(r.full_name || '—')}</span></td>
                                  <td><span class="responder-email">${escapeHtml(r.email || 'N/A')}</span></td>
                                  <td>${escapeHtml(r.barangay || '—')}</td>
                                  <td>${escapeHtml(r.contact_number || '—')}</td>
                                  <td><span class="badge bg-${r.role === 'admin' ? 'danger' : 'primary'}">${escapeHtml(r.role)}</span></td>
                                  <td><span class="badge bg-success">Active</span></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="text-center py-5 text-muted"><i class="fas fa-users fa-3x mb-3 d-block"></i><h5>No responders found</h5></div>`}
        `;
    } catch (error) { container.innerHTML = '<div class="alert alert-danger">Error loading responders</div>'; }
}

async function addResponder() {
    if (!currentProfile || currentProfile.role !== 'admin') {
        showToast('Access denied. Admins only.', 'warning', 4000);
        return;
    }
    var fullName = document.getElementById('respFullName').value.trim();
    var email = document.getElementById('respEmail').value.trim();
    var password = document.getElementById('respPassword').value;
    var barangay = document.getElementById('respBarangay').value.trim();
    var contact = document.getElementById('respContact').value.trim();
    if (!fullName || !email || !password || !barangay || !contact) { showToast('Please fill in all fields', 'warning'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'warning'); return; }

    var btn = document.getElementById('addResponderBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Adding...';

    try {
        var signUpResult = await supabaseClient.auth.signUp({
            email: email, password: password,
            options: { data: { full_name: fullName, barangay: barangay, contact_number: contact, role: 'responder' } }
        });
        if (signUpResult.error) {
            if (signUpResult.error.message.includes('User already registered')) { showToast('This email is already registered', 'warning'); return; }
            throw signUpResult.error;
        }
        if (!signUpResult.data.user) throw new Error('Failed to create user account');
        await new Promise(function(resolve) { setTimeout(resolve, 1000); });
        var updateResult = await supabaseClient.from('profiles').update({
            full_name: fullName, email: email, barangay: barangay, contact_number: contact, role: 'responder', updated_at: new Date()
        }).eq('id', signUpResult.data.user.id);
        if (updateResult.error) {
            var insertResult = await supabaseClient.from('profiles').insert([{
                id: signUpResult.data.user.id, full_name: fullName, email: email, barangay: barangay, contact_number: contact, role: 'responder'
            }]);
            if (insertResult.error) throw new Error('Failed to create profile: ' + insertResult.error.message);
        }
        showToast('Responder added successfully!', 'success');
        addResponderModal.hide();
        document.getElementById('addResponderForm').reset();
        loadResponders();
    } catch (error) { showToast('Failed to add responder: ' + error.message, 'danger'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus me-2"></i>Add Responder'; }
}

// ============================================
// ALERTS PAGE — visible to BOTH admin + responder
// Admin sees "New Alert" button. Responders can only VIEW.
// Responders + admins can view FULL alert details.
// ============================================

/* ===== ALERT DETAILS ===== */
function getAlertMediaUrls(alert) {
    if (!alert) return [];
    var raw = alert.media_urls;
    if (!raw) return [];
    try {
        var urls = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(urls)) return urls;
    } catch (e) {}
    return [];
}

function getAlertAIAnalysis(alert) {
    if (!alert || !alert.ai_analysis) return null;
    var raw = alert.ai_analysis;
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return null; }
}

function getAlertLocationText(alert) {
    if (!alert || !alert.location) return '—';
    var loc = alert.location;
    if (typeof loc === 'string' && loc.trim().startsWith('{')) {
        try {
            var obj = JSON.parse(loc);
            if (obj && obj.address) return obj.address;
        } catch (e) {}
    }
    if (typeof loc === 'object' && loc.address) return loc.address;
    return String(loc);
}

function getAlertCoords(alert) {
    if (!alert || !alert.location) return null;
    var loc = alert.location;
    if (typeof loc === 'string' && loc.trim().startsWith('{')) {
        try {
            var obj = JSON.parse(loc);
            if (obj && obj.latitude != null && obj.longitude != null) {
                return { lat: parseFloat(obj.latitude), lng: parseFloat(obj.longitude) };
            }
        } catch (e) {}
    }
    if (typeof loc === 'object' && loc.latitude != null && loc.longitude != null) {
        return { lat: parseFloat(loc.latitude), lng: parseFloat(loc.longitude) };
    }
    return null;
}

async function viewAlertDetails(alertId) {
    var alert = null;
    try {
        var res = await supabaseClient.from('alerts').select('*').eq('id', alertId).maybeSingle();
        if (res.data) alert = res.data;
    } catch (e) { console.warn('Fetch alert failed:', e); }
    if (!alert) { showToast('Alert not found', 'warning'); return; }

    // Ensure modal container exists
    var modalEl = document.getElementById('alertDetailModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.className = 'modal fade alert-detail-modal';
        modalEl.id = 'alertDetailModal';
        modalEl.tabIndex = -1;
        modalEl.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content" style="border-radius:16px;border:none;">
                    <div class="modal-header" style="border-bottom:1px solid var(--border);padding:20px 24px;">
                        <h5 class="modal-title fw-bold" id="alertDetailModalTitle">
                            <i class="fas fa-bell me-2 text-danger"></i>Alert Details
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="alertDetailModalBody" style="padding:24px;"></div>
                    <div class="modal-footer" id="alertDetailModalFooter" style="border-top:1px solid var(--border);padding:16px 24px;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
    }

    var typeIcon = getTypeIcon(alert.type);
    var typeClass = getTypeClass(alert.type);
    var priority = alert.priority || 'medium';
    var status = alert.status || 'draft';
    var ai = getAlertAIAnalysis(alert);
    var mediaUrls = getAlertMediaUrls(alert);
    var coords = getAlertCoords(alert);

    var createdDate = alert.created_at
        ? new Date(alert.created_at).toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : '—';

    var senderName = '—';
    if (alert.sent_by) {
        try {
            var pRes = await supabaseClient.from('profiles').select('full_name, role').eq('id', alert.sent_by).maybeSingle();
            if (pRes.data) senderName = (pRes.data.full_name || 'Admin') + (pRes.data.role ? ' (' + pRes.data.role + ')' : '');
        } catch (e) {}
    }

    var modalTitle = document.getElementById('alertDetailModalTitle');
    var modalBody = document.getElementById('alertDetailModalBody');
    var modalFooter = document.getElementById('alertDetailModalFooter');

    modalTitle.innerHTML = '<i class="fas ' + typeIcon + ' me-2 text-danger"></i>' + escapeHtml(alert.title || 'Alert Details');

    var mapId = 'alertDetailMap_' + String(alert.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

    modalBody.innerHTML = `
        <div class="d-flex gap-2 mb-4 flex-wrap align-items-center">
            <span class="badge priority-${priority}" style="font-size:0.75rem;padding:7px 18px;border-radius:50px;font-weight:700;text-transform:uppercase;">
                <i class="fas fa-exclamation-triangle me-1"></i>${priority} Priority
            </span>
            <span class="badge bg-${status === 'sent' ? 'success' : 'secondary'}" style="font-size:0.75rem;padding:7px 18px;border-radius:50px;font-weight:700;text-transform:uppercase;">
                <i class="fas fa-circle me-1" style="font-size:0.5rem;"></i>${escapeHtml(status)}
            </span>
            <span class="badge" style="font-size:0.75rem;padding:7px 18px;border-radius:50px;font-weight:700;text-transform:uppercase;background:color-mix(in oklab, var(--primary) 18%, transparent);color:var(--primary);">
                <i class="fas ${typeIcon} me-1"></i>${escapeHtml(alert.type || 'other')}
            </span>
        </div>

        <div class="mb-4">
            <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                <i class="fas fa-envelope-open-text me-1"></i>Message
            </label>
            <div class="alert-detail-message">${escapeHtml(alert.message || '—')}</div>
        </div>

        <div class="incident-modal-meta-grid mb-4">
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-user-shield me-1"></i>Sent By</div>
                <div class="val">${escapeHtml(senderName)}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-clock me-1"></i>Sent At</div>
                <div class="val" style="font-size:0.82rem;">${createdDate}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-phone me-1"></i>Contact</div>
                <div class="val">${escapeHtml(alert.contact_number || '—')}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-users me-1"></i>Recipients</div>
                <div class="val">${alert.recipients_count || 0}</div>
            </div>
            ${alert.barangay ? `
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-building me-1"></i>Barangay</div>
                <div class="val">${escapeHtml(alert.barangay)}</div>
            </div>` : ''}
            <div class="incident-modal-meta-item" style="grid-column: 1 / -1;">
                <div class="lbl"><i class="fas fa-map-marker-alt me-1"></i>Location</div>
                <div class="val">${escapeHtml(getAlertLocationText(alert))}</div>
            </div>
        </div>

        ${coords ? `
            <div class="mb-4">
                <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                    <i class="fas fa-map me-1"></i>Map
                </label>
                <div id="${mapId}" style="height:220px;border-radius:calc(var(--radius) + 2px);border:1px solid var(--border);overflow:hidden;"></div>
            </div>
        ` : ''}

        ${ai ? `
            <div class="mb-4">
                <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                    <i class="fas fa-robot me-1"></i>AI Analysis
                </label>
                <div class="ai-detail-card">
                    <div class="d-flex gap-2 flex-wrap mb-2">
                        <span class="ai-badge bg-${ai.priority === 'critical' ? 'danger' : ai.priority === 'high' ? 'warning' : ai.priority === 'medium' ? 'primary' : 'secondary'} text-white">
                            Priority: ${escapeHtml((ai.priority || 'medium').toUpperCase())}
                        </span>
                        <span class="ai-badge" style="background:var(--card);color:var(--card-foreground);border:1px solid var(--border);">
                            Confidence: ${ai.confidence != null ? (Number(ai.confidence) * 100).toFixed(0) + '%' : '—'}
                        </span>
                        ${ai.source ? `<span class="ai-badge" style="background:var(--muted);color:var(--muted-foreground);">${escapeHtml(ai.source)}</span>` : ''}
                    </div>
                    ${Array.isArray(ai.actions) && ai.actions.length ? `
                        <div class="small mb-1"><i class="fas fa-tasks me-1"></i>${escapeHtml(ai.actions.join(' · '))}</div>
                    ` : ''}
                    ${ai.verification ? `<div class="small"><i class="fas fa-shield-alt me-1"></i>${escapeHtml(ai.verification)}</div>` : ''}
                    ${Array.isArray(ai.reasoning) && ai.reasoning.length ? `
                        <div class="small text-muted mt-1"><i class="fas fa-lightbulb me-1"></i>${escapeHtml(ai.reasoning.join(' · '))}</div>
                    ` : ''}
                </div>
            </div>
        ` : ''}

        ${mediaUrls.length > 0 ? `
            <div class="mb-2">
                <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                    <i class="fas fa-paperclip me-1"></i>Attachments (${mediaUrls.length})
                </label>
            </div>
            <div class="d-flex flex-wrap gap-2">
                ${mediaUrls.map(function(m) {
                    var isVideo = m.type === 'video';
                    var url = m.url;
                    return `<div class="popup-media-item" style="width:90px;height:90px;" onclick="openLightbox('${url}', '${isVideo ? 'video' : 'image'}')">
                        ${isVideo
                            ? '<video src="' + url + '" muted></video><div class="play-overlay"><i class="fas fa-play"></i></div>'
                            : '<img src="' + url + '" alt="Attachment" onerror="this.style.display=\'none\'">'}
                    </div>`;
                }).join('')}
            </div>
        ` : ''}
    `;

    modalFooter.innerHTML = `
        <button class="btn btn-secondary" data-bs-dismiss="modal"><i class="fas fa-times me-1"></i>Close</button>
    `;

    var existing = bootstrap.Modal.getInstance(modalEl);
    if (existing) existing.dispose();
    var modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Init mini map after modal is shown
    if (coords) {
        modalEl.addEventListener('shown.bs.modal', function initMapOnce() {
            modalEl.removeEventListener('shown.bs.modal', initMapOnce);
            var mapContainer = document.getElementById(mapId);
            if (!mapContainer) return;
            var miniMap = L.map(mapId, { zoomControl: true, attributionControl: false })
                .setView([coords.lat, coords.lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
            L.polygon(BARANGAY_SCOPE.polygon, {
                color: '#2e7d32', weight: 2, opacity: 0.8,
                fillColor: '#2e7d32', fillOpacity: 0.06, dashArray: '8 4'
            }).addTo(miniMap);
            var typeIcon = getTypeIcon(alert.type);
            L.marker([coords.lat, coords.lng], {
                icon: L.divIcon({
                    html: '<div class="marker-pin ' + getTypeClass(alert.type) + '" style="position:relative;"><i class="fas ' + typeIcon + '"></i></div>',
                    className: 'custom-incident-marker',
                    iconSize: [30, 30], iconAnchor: [15, 30]
                })
            }).addTo(miniMap).bindPopup('<b>' + escapeHtml(alert.title || 'Alert') + '</b><br>' + escapeHtml(getAlertLocationText(alert)));
            setTimeout(function() { miniMap.invalidateSize(); }, 200);
        });
        // If already shown (unlikely on first open), init immediately
        if (modalEl.classList.contains('show')) {
            setTimeout(function() {
                var mapContainer = document.getElementById(mapId);
                if (!mapContainer || mapContainer._leaflet_id) return;
                var miniMap = L.map(mapId, { zoomControl: true, attributionControl: false })
                    .setView([coords.lat, coords.lng], 16);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
                var typeIcon = getTypeIcon(alert.type);
                L.marker([coords.lat, coords.lng], {
                    icon: L.divIcon({
                        html: '<div class="marker-pin ' + getTypeClass(alert.type) + '" style="position:relative;"><i class="fas ' + typeIcon + '"></i></div>',
                        className: 'custom-incident-marker',
                        iconSize: [30, 30], iconAnchor: [15, 30]
                    })
                }).addTo(miniMap);
                setTimeout(function() { miniMap.invalidateSize(); }, 200);
            }, 200);
        }
    }
}

async function loadAlerts() {
    var container = document.getElementById('pageContent');
    if (!container) return;

    var isAdmin = currentProfile && currentProfile.role === 'admin';

    try {
        var alertsResult = await supabaseClient.from('alerts').select('*').order('created_at', { ascending: false });
        var alerts = alertsResult.data || [];

        // Mark all notifications as read when opening the alerts page
        if (currentUser) markAllNotificationsRead();

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h4 class="fw-bold"><i class="fas fa-bell me-2"></i>Alerts</h4>
                ${isAdmin ? `
                    <button class="btn btn-danger d-inline-flex align-items-center gap-2" onclick="openAlertModal()">
                        <i class="fas fa-plus"></i>
                        <span>New Alert</span>
                    </button>
                ` : `
                    <span class="badge bg-secondary d-inline-flex align-items-center gap-2" style="font-size:0.75rem;padding:0.5rem 1rem;">
                        <i class="fas fa-eye"></i> View-only
                    </span>
                `}
            </div>
            ${alerts && alerts.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Title</th>
                                <th>Type</th>
                                <th>Priority</th>
                                <th>Status</th>
                                <th>Recipients</th>
                                <th class="text-end">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${alerts.map(function(alert) {
                                var typeIcon = getTypeIcon(alert.type);
                                var typeClass = getTypeClass(alert.type);
                                var pulse = getPriorityPulseClasses(alert.priority);
                                return `<tr class="${pulse.card}">
                                    <td>${new Date(alert.created_at).toLocaleString()}</td>
                                    <td>
                                        <div class="d-flex align-items-center gap-2">
                                            <div class="incident-type-icon ${typeClass} ${pulse.icon}" style="width:30px;height:30px;font-size:0.75rem;">
                                                <i class="fas ${typeIcon}"></i>
                                            </div>
                                            <span>${escapeHtml(alert.title || '')}</span>
                                        </div>
                                    </td>
                                    <td><span class="text-capitalize">${escapeHtml(alert.type || 'other')}</span></td>
                                    <td><span class="badge priority-${alert.priority || 'medium'}">${alert.priority || 'Medium'}</span></td>
                                    <td><span class="badge bg-${alert.status === 'sent' ? 'success' : 'secondary'}">${alert.status || 'Draft'}</span></td>
                                    <td>${alert.recipients_count || 0}</td>
                                    <td class="text-end">
                                        <button class="btn btn-sm btn-outline-primary" onclick="viewAlertDetails('${alert.id}')" title="View full details">
                                            <i class="fas fa-eye me-1"></i>View
                                        </button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="text-center py-5 text-muted"><i class="fas fa-bell-slash fa-3x mb-3 d-block"></i><h5>No alerts sent</h5></div>`}
        `;
    } catch (error) { container.innerHTML = '<div class="alert alert-danger">Error loading alerts</div>'; }
}

function loadProfile() {
    var container = document.getElementById('pageContent');
    if (!container) return;
    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-user me-2"></i>Profile</h4>
        <div class="card">
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-6"><label class="text-muted small">Full Name</label><p class="fw-semibold fs-5">${escapeHtml(currentProfile?.full_name || 'N/A')}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Email</label><p class="fw-semibold fs-5">${escapeHtml(currentUser?.email || 'N/A')}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Barangay</label><p class="fw-semibold fs-5">${escapeHtml(currentProfile?.barangay || 'N/A')}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Contact</label><p class="fw-semibold fs-5">${escapeHtml(currentProfile?.contact_number || 'N/A')}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Role</label><p class="fw-semibold fs-5"><span class="badge bg-${currentProfile?.role === 'admin' ? 'danger' : 'primary'}">${currentProfile?.role || 'Responder'}</span></p></div>
                    <div class="col-md-6"><label class="text-muted small">Member Since</label><p class="fw-semibold fs-5">${currentProfile?.created_at ? new Date(currentProfile.created_at).toLocaleDateString() : 'N/A'}</p></div>
                </div>
            </div>
        </div>
    `;
}

function openActionModal(incidentId) {
    document.getElementById('actionIncidentId').value = incidentId;
    actionModal.show();
}

async function performAction() {
    var incidentId = document.getElementById('actionIncidentId').value;
    var action = document.getElementById('actionType').value;
    var statusMap = { 'acknowledge': 'acknowledged', 'responding': 'responding', 'resolved': 'resolved', 'closed': 'closed' };
    try {
        var updateResult = await supabaseClient.from('incident_reports').update({
            status: statusMap[action], updated_at: new Date()
        }).eq('id', incidentId);
        if (updateResult.error) throw updateResult.error;
        showToast('Incident updated successfully', 'success');
        actionModal.hide();
        loadPage(document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard');
    } catch (error) { showToast('Failed to update: ' + error.message, 'danger'); }
}

// ============================================
// LOGOUT
// ============================================
async function logout() {
    try {
        stopSirenSound();
        stopPopupTimer();
        destroyAllCharts();
        destroyResponderMap();
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        if (realtimeChannel) { try { await supabaseClient.removeChannel(realtimeChannel); } catch (e) {} }
        if (notificationsRealtimeChannel) { try { await supabaseClient.removeChannel(notificationsRealtimeChannel); } catch (e) {} }
        await supabaseClient.auth.signOut();
        window.location.href = '../login.html';
    } catch (error) { window.location.href = '../login.html'; }
}

// ============================================
// EXPOSE GLOBALLY
// ============================================
window.acknowledgePopup = acknowledgePopup;
window.closePopup = closePopup;
window.openActionModal = openActionModal;
window.performAction = performAction;
window.addResponder = addResponder;
window.sendAlert = sendAlert;
window.logout = logout;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.viewIncidentMedia = viewIncidentMedia;
window.loadDashboard = loadDashboard;
window.loadIncidents = loadIncidents;
window.loadAnalytics = loadAnalytics;
window.loadResponders = loadResponders;
window.loadAlerts = loadAlerts;
window.loadProfile = loadProfile;
window.loadPage = loadPage;
window.toggleIncidentDescription = toggleIncidentDescription;
window.viewIncidentDetails = viewIncidentDetails;
window.filterIncidents = filterIncidents;
window.resetIncidentFilters = resetIncidentFilters;
window.renderIncidentCard = renderIncidentCard;
window.closeIncidentDetailModalAndAction = closeIncidentDetailModalAndAction;
window.showEmergencyPopup = showEmergencyPopup;
window.openAlertModal = openAlertModal;
window.analyzeAlertWithAI = analyzeAlertWithAI;
window.removeAlertMediaFile = removeAlertMediaFile;
window.resetAlertForm = resetAlertForm;
window.initGemini = initGemini;
window.analyzeWithGemini = analyzeWithGemini;
window.analyzeWithGeminiFallback = analyzeWithGeminiFallback;
window.enhancedAIAnalysis = enhancedAIAnalysis;
window.detectIncidentType = detectIncidentType;
window.showAlertNotificationPopup = showAlertNotificationPopup;
window.refreshUnreadAlertsCount = refreshUnreadAlertsCount;
window.viewAlertDetails = viewAlertDetails;

// ============================================
// INITIALIZE
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    var initAudioOnce = function() { initAudio(); };
    document.addEventListener('click', initAudioOnce, { once: true });
    document.addEventListener('touchstart', initAudioOnce, { once: true });
    document.addEventListener('keydown', initAudioOnce, { once: true });
    setTimeout(initAudio, 200);
    setTimeout(initResponderDashboard, 100);
});
