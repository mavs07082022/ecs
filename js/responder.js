let currentUser = null;
let currentProfile = null;
let allIncidents = [];
let actionModal = null;
let addResponderModal = null;
let alertModal = null;
let emergencyPopup = null;
let popupData = null;
let audioContext = null;
let isSirenPlaying = false;
let sirenInterval = null;
let sirenOscillators = [];
let sirenGainNodes = [];
let notificationSoundTimeout = null;
let realtimeChannel = null;
let isInitialized = false;
let pollingInterval = null;
let audioInitialized = false;
let processedIncidentIds = new Set();
let pendingSirenRequest = null;
let sirenType = 'professional';
let isOnIncidentsPage = false; // track current page for realtime refresh

// ============================================
// AUDIO FUNCTIONS
// ============================================
function initAudio() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') { audioContext.resume(); }
        if (audioContext.state === 'running') {
            audioInitialized = true;
            if (pendingSirenRequest) { playSirenSound(); pendingSirenRequest = null; }
            return true;
        }
        return false;
    } catch (error) { return false; }
}

function playSirenSound() {
    try {
        stopSirenSound();
        if (!audioInitialized) { pendingSirenRequest = true; return; }
        if (!audioContext || audioContext.state !== 'running') return;
        isSirenPlaying = true;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, audioContext.currentTime);
        gain.gain.setValueAtTime(0.15, audioContext.currentTime);
        sirenOscillators = [osc];
        sirenGainNodes = [gain];
        osc.start(audioContext.currentTime);
        let toggle = false;
        function updateSiren() {
            if (!isSirenPlaying) return;
            try {
                toggle = !toggle;
                osc.frequency.setValueAtTime(toggle ? 800 : 600, audioContext.currentTime);
                sirenInterval = setTimeout(updateSiren, 200);
            } catch (e) { isSirenPlaying = false; }
        }
        sirenInterval = setTimeout(updateSiren, 200);
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

function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;
    var container = document.getElementById('toastContainer') || createToastContainer();
    var colors = {
        success: 'bg-success text-white',
        danger: 'bg-danger text-white',
        warning: 'bg-warning text-dark',
        info: 'bg-info text-white',
        emergency: 'bg-danger text-white'
    };
    var icons = {
        success: 'check-circle',
        danger: 'times-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle',
        emergency: 'exclamation-triangle'
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

// Escape HTML to prevent breaking layout
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPopupMedia(mediaUrls) {
    var container = document.getElementById('popupMediaContainer');
    var list = document.getElementById('popupMediaList');
    if (!container || !list) return;
    if (!mediaUrls || mediaUrls.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    list.innerHTML = '';
    mediaUrls.forEach(function(media, index) {
        var item = document.createElement('div');
        item.className = 'popup-media-item';
        var isVideo = media.type === 'video';
        var url = media.url;
        if (isVideo) {
            item.innerHTML = '<video src="' + url + '" muted></video><div class="play-overlay"><i class="fas fa-play"></i></div>';
            item.onclick = function(e) { e.stopPropagation(); openLightbox(url, 'video'); };
        } else {
            item.innerHTML = '<img src="' + url + '" alt="Incident media" onerror="this.style.display=\'none\'">';
            item.onclick = function(e) { e.stopPropagation(); openLightbox(url, 'image'); };
        }
        list.appendChild(item);
    });
}

function openLightbox(mediaUrl, mediaType) {
    var lightbox = document.getElementById('mediaLightbox');
    var content = document.getElementById('lightboxContent');
    if (!lightbox || !content) return;
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
    if (typeof mediaUrls === 'string') { try { urls = JSON.parse(mediaUrls); } catch { urls = []; } }
    if (!urls || urls.length === 0) { showToast('No media attached', 'info'); return; }
    openLightbox(urls[0].url, urls[0].type);
}

// ============================================
// ACKNOWLEDGE POPUP
// ============================================
async function acknowledgePopup() {
    if (!popupData) {
        showToast('No incident data found', 'warning');
        return;
    }
    
    try {
        stopSirenSound();
        
        const btn = document.getElementById('acknowledgeBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Acknowledging...';
        }
        
        const updateData = {
            status: 'acknowledged',
            updated_at: new Date().toISOString()
        };
        
        try {
            updateData.acknowledged_at = new Date().toISOString();
            updateData.acknowledged_by = currentUser?.id;
        } catch (e) {
            console.warn('Some columns may not exist:', e.message);
        }
        
        const updateResult = await supabaseClient
            .from('incident_reports')
            .update(updateData)
            .eq('id', popupData.id);

        if (updateResult.error) {
            if (updateResult.error.message.includes('column') && updateResult.error.message.includes('does not exist')) {
                console.warn('Retrying without acknowledged_at column...');
                const retryResult = await supabaseClient
                    .from('incident_reports')
                    .update({
                        status: 'acknowledged',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', popupData.id);
                
                if (retryResult.error) throw retryResult.error;
            } else {
                throw updateResult.error;
            }
        }

        showToast('✅ Emergency acknowledged successfully!', 'success');
        
        try {
            if (typeof window.sendEmergencyEmailNotification === 'function') {
                const result = await window.sendEmergencyEmailNotification(popupData, true);
                if (result && result.success) {
                    showToast('📧 Email notifications sent to all users!', 'success', 5000);
                } else {
                    showToast('⚠️ Email notifications failed: ' + (result?.error || 'Unknown error'), 'warning', 5000);
                }
            } else {
                console.warn('⚠️ Email service not available');
                showToast('⚠️ Email service not loaded. Please check your configuration.', 'warning', 5000);
            }
        } catch (emailError) {
            console.error('Email notification error:', emailError);
            showToast('⚠️ Failed to send email notifications', 'warning', 3000);
        }
        
        closePopup();
        setTimeout(() => {
            loadDashboard();
        }, 500);

    } catch (error) {
        console.error('Acknowledge error:', error);
        showToast('Failed to acknowledge: ' + error.message, 'danger');
    } finally {
        const btn = document.getElementById('acknowledgeBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check me-2"></i>Acknowledge & Dispatch';
        }
    }
}

function closePopup() {
    stopSirenSound();
    const popup = document.getElementById('emergencyPopup');
    if (popup) popup.classList.remove('active');
    const indicator = document.getElementById('sirenIndicator');
    if (indicator) indicator.style.display = 'none';
    popupData = null;
}

function showEmergencyPopup(incident) {
    popupData = incident;
    
    document.getElementById('popupIncidentTitle').textContent = incident.title || 'Unknown';
    document.getElementById('popupIncidentType').textContent = incident.type || 'Unknown';
    document.getElementById('popupIncidentPriority').textContent = incident.priority || 'Medium';
    document.getElementById('popupIncidentPriority').className = 'badge priority-' + (incident.priority || 'medium');
    document.getElementById('popupIncidentLocation').textContent = incident.location || 'Unknown';
    document.getElementById('popupTime').textContent = incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Unknown';
    
    var priorityLabel = document.getElementById('popupPriorityLabel');
    if (priorityLabel) {
        priorityLabel.textContent = (incident.priority || 'MEDIUM').toUpperCase();
        priorityLabel.className = 'badge mt-2 priority-' + (incident.priority || 'medium');
        priorityLabel.style.fontSize = '1rem';
        priorityLabel.style.padding = '8px 20px';
    }
    
    supabaseClient.from('profiles').select('full_name').eq('id', incident.reporter_id).single()
        .then(function(result) {
            document.getElementById('popupReporter').textContent = result.data?.full_name || 'Anonymous';
        }).catch(function() {
            document.getElementById('popupReporter').textContent = 'Anonymous';
        });

    var mediaUrls = getMediaUrls(incident);
    renderPopupMedia(mediaUrls);

    document.getElementById('emergencyPopup').classList.add('active');
    document.getElementById('sirenIndicator').style.display = 'inline-block';
    
    playSirenSound();
    
    try {
        if (audioContext && audioContext.state === 'running') {
            var osc = audioContext.createOscillator();
            var gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioContext.currentTime);
            gain.gain.setValueAtTime(0.3, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
            osc.start(audioContext.currentTime);
            osc.stop(audioContext.currentTime + 0.2);
        }
    } catch(e) {}
}

// ============================================
// DASHBOARD FUNCTIONS
// ============================================
async function initResponderDashboard() {
    try {
        if (isInitialized) return;
        console.log('Initializing Responder Dashboard...');
        
        var sessionData = await supabaseClient.auth.getSession();
        var session = sessionData.data.session;
        if (!session) { window.location.href = '../login.html'; return; }

        currentUser = session.user;
        var profileResult = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
        if (profileResult.error || !profileResult.data) {
            showToast('Error loading profile', 'danger');
            return;
        }

        currentProfile = profileResult.data;
        if (currentProfile.role !== 'responder' && currentProfile.role !== 'admin') {
            showToast('Access denied', 'danger');
            await supabaseClient.auth.signOut();
            window.location.href = '../login.html';
            return;
        }

        document.getElementById('userNameDisplay').textContent = currentProfile.full_name + ' (' + currentProfile.role + ')';
        if (currentProfile.role === 'admin') document.getElementById('respondersLink').style.display = 'block';

        actionModal = new bootstrap.Modal(document.getElementById('actionModal'));
        addResponderModal = new bootstrap.Modal(document.getElementById('addResponderModal'));
        alertModal = new bootstrap.Modal(document.getElementById('alertModal'));

        await loadDashboard();

        document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var page = this.dataset.page;
                document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(function(l) { l.classList.remove('active'); });
                this.classList.add('active');
                loadPage(page);
            });
        });

        setupRealtime();
        setupPolling();
        await checkNewEmergencies();

        isInitialized = true;
        console.log('Responder Dashboard initialized');
    } catch (error) {
        console.error('Init error:', error);
        showToast('Error loading dashboard', 'danger');
    }
}

function loadPage(page) {
    isOnIncidentsPage = (page === 'incidents');
    switch(page) {
        case 'dashboard': loadDashboard(); break;
        case 'incidents': loadIncidents(); break;
        case 'responders': loadResponders(); break;
        case 'alerts': loadAlerts(); break;
        case 'profile': loadProfile(); break;
        default: loadDashboard();
    }
}

async function loadDashboard() {
    var container = document.getElementById('pageContent');
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;

        var total = reports.length || 0;
        var active = reports.filter(function(r) { return !['resolved', 'closed'].includes(r.status); }).length || 0;
        var critical = reports.filter(function(r) { return r.priority === 'critical' && !['resolved', 'closed'].includes(r.status); }).length || 0;
        var resolved = reports.filter(function(r) { return r.status === 'resolved'; }).length || 0;

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h4 class="fw-bold">Responder Dashboard</h4>
                    <p class="text-muted">Barangay ${currentProfile?.barangay || 'N/A'}</p>
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    ${currentProfile?.role === 'admin' ? `
                        <button class="btn btn-danger" onclick="addResponderModal.show()">
                            <i class="fas fa-user-plus me-2"></i>Add Responder
                        </button>
                    ` : ''}
                </div>
            </div>

            <div class="row g-4 mb-4">
                <div class="col-md-3"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number">${total}</div><div class="text-muted small">Total Incidents</div></div><div class="text-primary"><i class="fas fa-file-alt fa-2x"></i></div></div></div></div>
                <div class="col-md-3"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number">${active}</div><div class="text-muted small">Active</div></div><div class="text-warning"><i class="fas fa-clock fa-2x"></i></div></div></div></div>
                <div class="col-md-3"><div class="stat-card" style="border-left: 3px solid #dc3545;"><div class="d-flex justify-content-between align-items-center"><div><div class="number text-danger">${critical}</div><div class="text-muted small">Critical</div></div><div class="text-danger"><i class="fas fa-exclamation-triangle fa-2x"></i></div></div></div></div>
                <div class="col-md-3"><div class="stat-card"><div class="d-flex justify-content-between align-items-center"><div><div class="number text-success">${resolved}</div><div class="text-muted small">Resolved</div></div><div class="text-success"><i class="fas fa-check-circle fa-2x"></i></div></div></div></div>
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
                                return `
                                    <div class="list-group-item d-flex align-items-center gap-3">
                                        <span class="badge priority-${incident.priority || 'medium'}">${incident.priority || 'Medium'}</span>
                                        <div class="flex-grow-1">
                                            <div class="fw-semibold">${incident.title}</div>
                                            <div class="small text-muted">${incident.type} • ${incident.location}</div>
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
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading dashboard</div>';
    }
}

// ============================================
// ENHANCED INCIDENTS PAGE
// ============================================
async function loadIncidents() {
    var container = document.getElementById('pageContent');
    try {
        var reportsResult = await supabaseClient
            .from('incident_reports')
            .select('*')
            .order('created_at', { ascending: false });
        var reports = reportsResult.data || [];
        allIncidents = reports;

        var total = reports.length;
        var active = reports.filter(function(r) {
            return !['resolved', 'closed'].includes(r.status);
        }).length;
        var critical = reports.filter(function(r) {
            return r.priority === 'critical' && !['resolved', 'closed'].includes(r.status);
        }).length;
        var resolved = reports.filter(function(r) {
            return ['resolved', 'closed'].includes(r.status);
        }).length;

        container.innerHTML = `
            <!-- Header -->
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
                <!-- Filter Bar -->
                <div class="incidents-filter-bar">
                    <div class="row g-2 align-items-center">
                        <div class="col-md-5">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text bg-white"><i class="fas fa-search text-muted"></i></span>
                                <input type="text" class="form-control" id="incidentSearchInput" placeholder="Search incidents by title, type, or location..." oninput="filterIncidents()">
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

                <!-- Incidents List -->
                <div id="incidentsListContainer">
                    ${reports.map(function(incident) {
                        return renderIncidentCard(incident);
                    }).join('')}
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

            <!-- Incident Detail Modal -->
            <div class="modal fade" id="incidentDetailModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content" style="border-radius:16px;border:none;">
                        <div class="modal-header" style="border-bottom:1px solid #f0f2f5;padding:20px 24px;">
                            <h5 class="modal-title fw-bold" id="incidentDetailModalTitle">
                                <i class="fas fa-file-alt me-2 text-primary"></i>Incident Details
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="incidentDetailModalBody" style="padding:24px;">
                            <!-- Filled dynamically -->
                        </div>
                        <div class="modal-footer" id="incidentDetailModalFooter" style="border-top:1px solid #f0f2f5;padding:16px 24px;">
                            <!-- Filled dynamically -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading incidents:', error);
        container.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>Error loading incidents. Please try again.</div>';
    }
}

// ============================================
// RENDER SINGLE INCIDENT CARD
// ============================================
function renderIncidentCard(incident) {
    var mediaUrls = getMediaUrls(incident);
    var mediaUrlsJson = JSON.stringify(mediaUrls).replace(/"/g, '&quot;');

    // === REAL description from the reporter/resident — no fake fallback ===
    var rawDescription = (incident.description === null || incident.description === undefined)
        ? ''
        : String(incident.description).trim();

    var hasDescription = rawDescription.length > 0;
    var escapedDescription = escapeHtml(rawDescription);

    var typeIconMap = {
        fire: 'fa-fire',
        medical: 'fa-heart-pulse',
        accident: 'fa-car-burst',
        flood: 'fa-water',
        crime: 'fa-shield-halved',
        other: 'fa-circle-exclamation'
    };
    var typeIcon = typeIconMap[incident.type] || 'fa-circle-exclamation';
    var typeClass = typeIconMap[incident.type] ? incident.type : 'other';
    var priority = incident.priority || 'medium';
    var status = incident.status || 'reported';
    var createdDate = incident.created_at ? new Date(incident.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Unknown';

    var isLongDescription = rawDescription.length > 180;
    var safeSearch = (incident.title + ' ' + incident.type + ' ' + (incident.location || '') + ' ' + rawDescription)
        .toLowerCase().replace(/"/g, '').replace(/'/g, '');

    var descHtml = '';
    if (hasDescription) {
        descHtml = `
            <div class="incident-description-box ${isLongDescription ? 'clamped' : ''}" id="desc-${incident.id}">
                <span class="desc-label"><i class="fas fa-align-left me-1"></i>Description</span>
                <span class="desc-text">${escapedDescription}</span>
            </div>
        `;
    } else {
        descHtml = `<div class="incident-no-desc"><i class="fas fa-info-circle"></i>No description provided by reporter</div>`;
    }

    return `
        <div class="incident-card priority-${priority}" data-incident-id="${incident.id}"
             data-search="${safeSearch}"
             data-status="${status}" data-priority="${priority}">
            <div class="incident-card-header">
                <div class="d-flex align-items-start gap-3 flex-grow-1" style="min-width:0;">
                    <div class="incident-type-icon ${typeClass}">
                        <i class="fas ${typeIcon}"></i>
                    </div>
                    <div style="min-width:0;flex:1;">
                        <div class="incident-card-title">
                            <span style="word-break:break-word;">${escapeHtml(incident.title) || 'Untitled Incident'}</span>
                        </div>
                        <div class="incident-card-meta">
                            <span><i class="fas fa-tag"></i>${escapeHtml(incident.type) || 'Unknown'}</span>
                            <span><i class="fas fa-map-marker-alt"></i>${escapeHtml(incident.location) || 'Unknown location'}</span>
                            <span><i class="fas fa-clock"></i>${createdDate}</span>
                        </div>
                    </div>
                </div>
                <div class="d-flex flex-column align-items-end gap-2 flex-shrink-0">
                    <span class="badge priority-${priority}" style="font-size:0.68rem;padding:5px 14px;border-radius:50px;font-weight:700;text-transform:uppercase;">${priority}</span>
                    <span class="status-badge status-${status}">${status}</span>
                </div>
            </div>
            <div class="incident-card-body">
                ${descHtml}
                ${mediaUrls.length > 0 ? `
                    <div class="d-flex align-items-center gap-2">
                        <span class="media-badge" onclick="viewIncidentMedia('${mediaUrlsJson.replace(/'/g, "&#39;")}')">
                            <i class="fas fa-paperclip me-1"></i>${mediaUrls.length} attachment${mediaUrls.length > 1 ? 's' : ''}
                        </span>
                    </div>
                ` : ''}
            </div>
            <div class="incident-card-footer">
                <div class="small text-muted">
                    <i class="fas fa-hashtag me-1"></i>ID: ${incident.id.substring(0, 8)}...
                </div>
                <div class="incident-action-group">
                    ${isLongDescription ? `
                        <button class="btn btn-sm btn-outline-secondary btn-incident-action" onclick="toggleIncidentDescription('${incident.id}', this)">
                            <i class="fas fa-chevron-down"></i>Read More
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline-primary btn-incident-action" onclick="viewIncidentDetails('${incident.id}')">
                        <i class="fas fa-eye"></i>View Full Details
                    </button>
                    <button class="btn btn-sm btn-primary btn-incident-action" onclick="openActionModal('${incident.id}')">
                        <i class="fas fa-edit"></i>Update
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// TOGGLE DESCRIPTION (READ MORE / LESS)
// ============================================
function toggleIncidentDescription(incidentId, btn) {
    var descBox = document.getElementById('desc-' + incidentId);
    if (!descBox) return;

    var incident = allIncidents.find(function(i) { return i.id === incidentId; });
    if (!incident) return;

    var rawDescription = (incident.description === null || incident.description === undefined)
        ? '' : String(incident.description).trim();
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

// ============================================
// VIEW FULL INCIDENT DETAILS MODAL
// ============================================
async function viewIncidentDetails(incidentId) {
    // Always fetch fresh from DB so description is real-time
    var incident = null;
    try {
        var freshRes = await supabaseClient.from('incident_reports').select('*').eq('id', incidentId).maybeSingle();
        if (freshRes.data) {
            incident = freshRes.data;
            // Update cache
            var idx = allIncidents.findIndex(function(i) { return i.id === incidentId; });
            if (idx >= 0) allIncidents[idx] = incident;
        }
    } catch (e) { /* fall through to cache */ }

    if (!incident) {
        incident = allIncidents.find(function(i) { return i.id === incidentId; });
    }
    if (!incident) {
        showToast('Incident not found', 'warning');
        return;
    }

    var mediaUrls = getMediaUrls(incident);
    var typeIconMap = {
        fire: 'fa-fire',
        medical: 'fa-heart-pulse',
        accident: 'fa-car-burst',
        flood: 'fa-water',
        crime: 'fa-shield-halved',
        other: 'fa-circle-exclamation'
    };
    var typeIcon = typeIconMap[incident.type] || 'fa-circle-exclamation';
    var priority = incident.priority || 'medium';
    var status = incident.status || 'reported';

    var reporterName = 'Unknown Reporter';
    if (incident.reporter_id) {
        try {
            var profResult = await supabaseClient.from('profiles').select('full_name, contact_number, email').eq('id', incident.reporter_id).maybeSingle();
            if (profResult.data) {
                reporterName = profResult.data.full_name || 'Unknown';
            }
        } catch (e) { /* ignore */ }
    }

    var createdDate = incident.created_at ? new Date(incident.created_at).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Unknown';

    var modalTitle = document.getElementById('incidentDetailModalTitle');
    var modalBody = document.getElementById('incidentDetailModalBody');
    var modalFooter = document.getElementById('incidentDetailModalFooter');

    if (!modalTitle || !modalBody || !modalFooter) {
        showToast('Detail modal not available', 'warning');
        return;
    }

    var rawDescription = (incident.description === null || incident.description === undefined)
        ? '' : String(incident.description).trim();
    var escapedDescription = escapeHtml(rawDescription);
    var descBlock = rawDescription.length > 0
        ? `<div class="incident-modal-description">${escapedDescription}</div>`
        : `<div class="incident-no-desc"><i class="fas fa-info-circle"></i>No description provided by reporter</div>`;

    modalTitle.innerHTML = '<i class="fas ' + typeIcon + ' me-2 text-primary"></i>' + escapeHtml(incident.title || 'Incident Details');

    modalBody.innerHTML = `
        <!-- Priority & Status Row -->
        <div class="d-flex gap-2 mb-4 flex-wrap">
            <span class="badge priority-${priority}" style="font-size:0.75rem;padding:7px 18px;border-radius:50px;font-weight:700;text-transform:uppercase;">
                <i class="fas fa-exclamation-triangle me-1"></i>${priority} Priority
            </span>
            <span class="status-badge status-${status}" style="font-size:0.75rem;padding:7px 18px;">
                <i class="fas fa-circle me-1" style="font-size:0.5rem;"></i>${status}
            </span>
        </div>

        <!-- Meta Grid -->
        <div class="incident-modal-meta-grid mb-4">
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-tag me-1"></i>Type</div>
                <div class="val text-capitalize">${escapeHtml(incident.type) || 'Unknown'}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-map-marker-alt me-1"></i>Location</div>
                <div class="val">${escapeHtml(incident.location) || 'Unknown'}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-user me-1"></i>Reporter</div>
                <div class="val">${escapeHtml(reporterName)}</div>
            </div>
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-clock me-1"></i>Reported</div>
                <div class="val" style="font-size:0.82rem;">${createdDate}</div>
            </div>
            ${incident.barangay ? `
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-building me-1"></i>Barangay</div>
                <div class="val">${escapeHtml(incident.barangay)}</div>
            </div>
            ` : ''}
            ${incident.contact_number ? `
            <div class="incident-modal-meta-item">
                <div class="lbl"><i class="fas fa-phone me-1"></i>Contact</div>
                <div class="val">${escapeHtml(incident.contact_number)}</div>
            </div>
            ` : ''}
        </div>

        <!-- Full Description -->
        <div class="mb-2">
            <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                <i class="fas fa-align-left me-1"></i>Full Description
            </label>
        </div>
        ${descBlock}

        <!-- Attachments -->
        ${mediaUrls.length > 0 ? `
            <div class="mb-2 mt-4">
                <label class="fw-bold small text-uppercase text-muted" style="letter-spacing:0.5px;">
                    <i class="fas fa-paperclip me-1"></i>Attachments (${mediaUrls.length})
                </label>
            </div>
            <div class="d-flex flex-wrap gap-2">
                ${mediaUrls.map(function(m, idx) {
                    var isVideo = m.type === 'video';
                    return `
                        <div class="popup-media-item" style="width:90px;height:90px;" onclick="openLightbox('${m.url}', '${isVideo ? 'video' : 'image'}')">
                            ${isVideo
                                ? '<video src="' + m.url + '" muted></video><div class="play-overlay"><i class="fas fa-play"></i></div>'
                                : '<img src="' + m.url + '" alt="Attachment ' + (idx+1) + '" onerror="this.style.display=\'none\'">'}
                        </div>
                    `;
                }).join('')}
            </div>
        ` : ''}
    `;

    modalFooter.innerHTML = `
        <button class="btn btn-secondary" data-bs-dismiss="modal"><i class="fas fa-times me-1"></i>Close</button>
        <button class="btn btn-primary" onclick="closeIncidentDetailModalAndAction('${incident.id}')">
            <i class="fas fa-edit me-1"></i>Update Incident
        </button>
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
    setTimeout(function() {
        openActionModal(incidentId);
    }, 300);
}

// ============================================
// FILTER INCIDENTS
// ============================================
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

        if (matchSearch && matchStatus && matchPriority) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    if (noResults) {
        noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    }
}

// ============================================
// RESET INCIDENT FILTERS
// ============================================
function resetIncidentFilters() {
    var searchInput = document.getElementById('incidentSearchInput');
    var statusFilter = document.getElementById('incidentStatusFilter');
    var priorityFilter = document.getElementById('incidentPriorityFilter');
    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = '';
    if (priorityFilter) priorityFilter.value = '';
    filterIncidents();
}

// ============================================
// RESPONDERS
// ============================================
async function loadResponders() {
    var container = document.getElementById('pageContent');
    try {
        var respondersResult = await supabaseClient.from('profiles').select('*').in('role', ['responder', 'admin']).order('created_at', { ascending: false });
        var responders = respondersResult.data || [];

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h4 class="fw-bold"><i class="fas fa-users me-2"></i>Responders</h4>
                <button class="btn btn-danger" onclick="addResponderModal.show()"><i class="fas fa-user-plus me-2"></i>Add Responder</button>
            </div>
            ${responders && responders.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead><tr><th>Name</th><th>Email</th><th>Barangay</th><th>Contact</th><th>Role</th><th>Status</th></tr></thead>
                        <tbody>
                            ${responders.map(function(r) {
                                return `<tr><td>${r.full_name}</td><td>${r.email || 'N/A'}</td><td>${r.barangay}</td><td>${r.contact_number}</td><td><span class="badge bg-${r.role === 'admin' ? 'danger' : 'primary'}">${r.role}</span></td><td><span class="badge bg-success">Active</span></td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <div class="text-center py-5 text-muted"><i class="fas fa-users fa-3x mb-3 d-block"></i><h5>No responders found</h5></div>
            `}
        `;
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading responders</div>';
    }
}

async function addResponder() {
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
            email: email,
            password: password,
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
    } catch (error) {
        showToast('Failed to add responder: ' + error.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-user-plus me-2"></i>Add Responder';
    }
}

// ============================================
// ALERTS
// ============================================
async function loadAlerts() {
    var container = document.getElementById('pageContent');
    try {
        var alertsResult = await supabaseClient.from('alerts').select('*').order('created_at', { ascending: false });
        var alerts = alertsResult.data || [];

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h4 class="fw-bold"><i class="fas fa-broadcast me-2"></i>Alerts</h4>
                <button class="btn btn-danger" onclick="alertModal.show()"><i class="fas fa-plus me-2"></i>New Alert</button>
            </div>
            ${alerts && alerts.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead><tr><th>Date</th><th>Title</th><th>Priority</th><th>Status</th><th>Recipients</th></tr></thead>
                        <tbody>
                            ${alerts.map(function(alert) {
                                return `<tr><td>${new Date(alert.created_at).toLocaleString()}</td><td>${alert.title}</td><td><span class="badge priority-${alert.priority || 'medium'}">${alert.priority || 'Medium'}</span></td><td><span class="badge bg-${alert.status === 'sent' ? 'success' : 'secondary'}">${alert.status || 'Draft'}</span></td><td>${alert.recipients_count || 0}</td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <div class="text-center py-5 text-muted"><i class="fas fa-broadcast fa-3x mb-3 d-block"></i><h5>No alerts sent</h5></div>
            `}
        `;
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error loading alerts</div>';
    }
}

function loadProfile() {
    var container = document.getElementById('pageContent');
    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-user me-2"></i>Profile</h4>
        <div class="card">
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-6"><label class="text-muted small">Full Name</label><p class="fw-semibold fs-5">${currentProfile?.full_name || 'N/A'}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Email</label><p class="fw-semibold fs-5">${currentUser?.email || 'N/A'}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Barangay</label><p class="fw-semibold fs-5">${currentProfile?.barangay || 'N/A'}</p></div>
                    <div class="col-md-6"><label class="text-muted small">Contact</label><p class="fw-semibold fs-5">${currentProfile?.contact_number || 'N/A'}</p></div>
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
    } catch (error) {
        showToast('Failed to update: ' + error.message, 'danger');
    }
}

async function sendAlert() {
    var title = document.getElementById('alertTitle').value.trim();
    var message = document.getElementById('alertMessage').value.trim();
    var priority = document.getElementById('alertPriority').value;
    if (!title || !message) { showToast('Please fill in all fields', 'warning'); return; }

    var btn = document.querySelector('#alertModal .btn-danger');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';

    try {
        var residentsResult = await supabaseClient.from('profiles').select('id').eq('role', 'resident');
        var insertResult = await supabaseClient.from('alerts').insert([{
            title: title, message: message, priority: priority, status: 'sent',
            recipients_count: residentsResult.data?.length || 0, sent_by: currentUser.id, sent_at: new Date()
        }]);
        if (insertResult.error) throw insertResult.error;

        showToast('Alert sent to ' + (residentsResult.data?.length || 0) + ' residents', 'success');
        alertModal.hide();
        document.getElementById('alertForm').reset();
        loadAlerts();
    } catch (error) {
        showToast('Failed to send alert: ' + error.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Send Alert';
    }
}

// ============================================
// CHECK NEW EMERGENCIES
// ============================================
async function checkNewEmergencies() {
    try {
        var reportsResult = await supabaseClient.from('incident_reports').select('*').eq('status', 'reported').order('created_at', { ascending: false }).limit(1);
        var reports = reportsResult.data || [];
        if (reports && reports.length > 0) {
            var latestReport = reports[0];
            if (!processedIncidentIds.has(latestReport.id)) {
                processedIncidentIds.add(latestReport.id);
                showEmergencyPopup(latestReport);
            }
        }
    } catch (error) { console.error('Check emergencies error:', error); }
}

// ============================================
// SETUP POLLING
// ============================================
function setupPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async function() {
        try {
            var reportsResult = await supabaseClient.from('incident_reports').select('*').eq('status', 'reported').order('created_at', { ascending: false }).limit(1);
            var reports = reportsResult.data || [];
            if (reports && reports.length > 0) {
                var latestReport = reports[0];
                if (!processedIncidentIds.has(latestReport.id)) {
                    processedIncidentIds.add(latestReport.id);
                    showEmergencyPopup(latestReport);
                    loadPage(document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard');
                }
            }
        } catch (error) {}
    }, 5000);
}

// ============================================
// SETUP REALTIME (ADDED: real-time description updates)
// ============================================
function setupRealtime() {
    if (realtimeChannel) { try { supabaseClient.removeChannel(realtimeChannel); } catch (e) {} }
    
    realtimeChannel = supabaseClient
        .channel('responder-updates')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports' }, function(payload) {
            if (payload.new && payload.new.status === 'reported') {
                var incidentId = payload.new.id;
                if (!processedIncidentIds.has(incidentId)) {
                    processedIncidentIds.add(incidentId);
                    showEmergencyPopup(payload.new);
                    showToast('🚨 NEW EMERGENCY REPORTED!', 'emergency', 10000);
                    loadPage(document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard');
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incident_reports' }, function(payload) {
            if (payload.new && payload.new.status === 'acknowledged' && popupData && popupData.id === payload.new.id) {
                stopSirenSound();
                closePopup();
                showToast('Incident has been acknowledged', 'success');
            }

            // Update local cache so any open modal uses fresh data
            if (payload.new) {
                var idx = allIncidents.findIndex(function(i) { return i.id === payload.new.id; });
                if (idx >= 0) allIncidents[idx] = Object.assign({}, allIncidents[idx], payload.new);
                else allIncidents.unshift(payload.new);
            }

            // If user is currently on the Incidents page, refresh the card list live
            if (isOnIncidentsPage) {
                var activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
                if (activePage === 'incidents') {
                    // Refresh just the incident cards in place (avoids losing search/filter state)
                    refreshIncidentsListInPlace();
                }
            } else {
                loadPage(document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page || 'dashboard');
            }
        })
        .subscribe();
}

// Refresh only the card list on the Incidents page without full re-render
function refreshIncidentsListInPlace() {
    var listContainer = document.getElementById('incidentsListContainer');
    if (!listContainer) return;

    // Re-render only the cards
    listContainer.innerHTML = allIncidents.map(function(incident) {
        return renderIncidentCard(incident);
    }).join('');

    // Re-apply current filters
    if (typeof filterIncidents === 'function') filterIncidents();
}

// ============================================
// LOGOUT
// ============================================
async function logout() {
    try {
        stopSirenSound();
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        if (realtimeChannel) { try { await supabaseClient.removeChannel(realtimeChannel); } catch (e) {} }
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

// ============================================
// INITIALIZE
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    document.addEventListener('click', function() { initAudio(); }, { once: true });
    document.addEventListener('touchstart', function() { initAudio(); }, { once: true });
    document.addEventListener('keydown', function() { initAudio(); }, { once: true });
    
    setTimeout(initResponderDashboard, 100);
});

// CSS (dynamic fallback — the main styles are already in dashboard.html)
var style = document.createElement('style');
style.textContent = `
    .media-badge { display: inline-block; font-size: 0.7rem; padding: 4px 10px; border-radius: 30px; background: #e8f0fe; color: #0d6efd; cursor: pointer; transition: all 0.2s ease; border: 1px solid transparent; }
    .media-badge:hover { background: #0d6efd; color: white; border-color: #0d6efd; transform: scale(1.05); }
    .status-badge { font-size: 0.7rem; padding: 4px 14px; border-radius: 50px; font-weight: 600; text-transform: capitalize; }
    .status-reported { background: #f8d7da; color: #721c24; }
    .status-acknowledged { background: #cce5ff; color: #004085; }
    .status-responding { background: #fff3cd; color: #856404; }
    .status-resolved { background: #d4edda; color: #155724; }
    .status-closed { background: #e2e3e5; color: #383d41; }
    .priority-critical { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-medium { background: #ffc107; color: #212529; }
    .priority-low { background: #0d6efd; color: white; }
`;
document.head.appendChild(style);