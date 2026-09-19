/* ============================================================
   Culiat Public Safety — Emergency Hotline Management Module
   v7 — Fixed FB icon rendering + type icons always visible
   ============================================================ */

let currentUser = null;
let currentProfile = null;
let allCalls = [];
let hotlineRealtimeChannel = null;
let callDetailModal = null;
let newCallModal = null;
let callTimerInterval = null;
let activeCallSeconds = 0;

// ============================================
// INIT
// ============================================
async function initHotlineDashboard() {
    try {
        console.log('📞 Initializing Hotline Dashboard...');

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = '../index.html'; return; }

        currentUser = session.user;
        const { data: profile } = await supabaseClient
            .from('profiles').select('*').eq('id', currentUser.id).maybeSingle();

        if (!profile) { showToast('Profile not found', 'danger'); return; }
        currentProfile = profile;

        if (currentProfile.role !== 'responder' && currentProfile.role !== 'admin') {
            showToast('Access denied. Hotline operators only.', 'danger');
            setTimeout(() => { window.location.href = '../login.html'; }, 1500);
            return;
        }

        const nameEl = document.getElementById('userNameDisplay');
        if (nameEl) nameEl.textContent = (currentProfile.full_name || 'Operator') + ' (' + currentProfile.role + ')';

        await registerOperator();

        const detailEl = document.getElementById('callDetailModal');
        const newEl = document.getElementById('newCallModal');
        if (detailEl) callDetailModal = new bootstrap.Modal(detailEl);
        if (newEl) newCallModal = new bootstrap.Modal(newEl);

        document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(link => {
            link.addEventListener('click', function (e) {
                const href = this.getAttribute('href');
                if (href && href !== '#') return;
                e.preventDefault();
                const page = this.dataset.page;
                if (!page) return;
                document.querySelectorAll('.dashboard-sidebar .nav-link').forEach(l => l.classList.remove('active'));
                this.classList.add('active');
                loadHotlinePage(page);
            });
        });

        await loadHotlineDashboard();
        setupHotlineRealtime();
        startCallTimer();

        console.log('✅ Hotline Dashboard ready');
    } catch (err) {
        console.error('Hotline init error:', err);
        showToast('Error loading hotline dashboard', 'danger');
    }
}

async function registerOperator() {
    try {
        await supabaseClient.from('hotline_operators').upsert([{
            user_id: currentUser.id,
            shift: getCurrentShift(),
            station: 'Main Station',
            is_active: true
        }], { onConflict: 'user_id' });
    } catch (e) { console.warn('Operator register failed:', e); }
}

function getCurrentShift() {
    const h = new Date().getHours();
    if (h >= 6 && h < 14) return 'day';
    if (h >= 14 && h < 22) return 'night';
    return 'graveyard';
}

// ============================================
// PAGE ROUTING
// ============================================
function loadHotlinePage(page) {
    switch (page) {
        case 'dashboard': loadHotlineDashboard(); break;
        case 'new-call': openNewCallModal(); break;
        case 'all-calls': loadAllCalls(); break;
        case 'active': loadActiveCalls(); break;
        case 'history': loadCallHistory(); break;
        case 'operators': loadOperators(); break;
        case 'profile': loadHotlineProfile(); break;
        default: loadHotlineDashboard();
    }
}

// ============================================
// TYPE HELPERS — identical to responder.js
// ============================================
function getTypeIcon(type) {
    const map = {
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
    const map = {
        fire: 'fire',
        medical: 'medical',
        accident: 'accident',
        flood: 'flood',
        crime: 'crime',
        armed_conflict: 'crime',
        natural_disaster: 'flood',
        other: 'other'
    };
    return map[type] || 'other';
}

function getTypeLabel(type) {
    const map = {
        fire: 'Fire',
        medical: 'Medical',
        accident: 'Accident',
        flood: 'Flood',
        crime: 'Crime',
        armed_conflict: 'Armed Conflict',
        natural_disaster: 'Natural Disaster',
        other: 'Other'
    };
    return map[type] || 'Other';
}

function getPriorityPulseClasses(priority) {
    if (priority === 'critical') return { card: 'pulse-critical', icon: 'pulse-icon-critical' };
    if (priority === 'high') return { card: 'pulse-high', icon: '' };
    return { card: '', icon: '' };
}

function isFacebookCall(call) {
    return (call.caller_number || '').startsWith('FB:') || call.call_type === 'facebook';
}

// ============================================
// DASHBOARD
// ============================================
async function loadHotlineDashboard() {
    const container = document.getElementById('pageContent');
    if (!container) return;

    try {
        const { data: calls, error } = await supabaseClient
            .from('hotline_calls').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        allCalls = calls || [];

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayCalls = allCalls.filter(c => new Date(c.created_at) >= today);
        const active = allCalls.filter(c => ['pending', 'received', 'verifying', 'verified', 'assigned', 'responding'].includes(c.status));
        const critical = active.filter(c => c.priority === 'critical');
        const resolvedToday = todayCalls.filter(c => ['resolved', 'closed', 'processed'].includes(c.status));

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h4 class="fw-bold mb-1"><i class="fas fa-phone-volume me-2"></i>Hotline Management</h4>
                    <p class="text-muted mb-0">Barangay ${escapeHtml(currentProfile?.barangay || 'N/A')} · ${getCurrentShift().toUpperCase()} shift</p>
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-success" onclick="openNewCallModal()">
                        <i class="fas fa-phone me-2"></i>Log Incoming Call
                    </button>
                    <button class="btn btn-outline-secondary" onclick="loadHotlineDashboard()">
                        <i class="fas fa-sync me-2"></i>Refresh
                    </button>
                </div>
            </div>

            <div class="row g-4 mb-4">
                <div class="col-md-3">
                    <div class="stat-card" style="border-left:4px solid var(--primary);">
                        <div class="d-flex justify-content-between align-items-center">
                            <div><div class="number">${todayCalls.length}</div><div class="text-muted small">Today's Calls</div></div>
                            <div class="text-primary"><i class="fas fa-phone fa-2x"></i></div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left:4px solid #fd7e14;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div><div class="number text-warning">${active.length}</div><div class="text-muted small">Active</div></div>
                            <div class="text-warning"><i class="fas fa-hourglass-half fa-2x"></i></div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left:4px solid #dc3545;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div><div class="number text-danger">${critical.length}</div><div class="text-muted small">Critical</div></div>
                            <div class="text-danger"><i class="fas fa-exclamation-triangle fa-2x"></i></div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left:4px solid #28a745;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div><div class="number text-success">${resolvedToday.length}</div><div class="text-muted small">Resolved Today</div></div>
                            <div class="text-success"><i class="fas fa-check-circle fa-2x"></i></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h6 class="mb-0"><i class="fas fa-list me-2"></i>Active Hotline Calls</h6>
                    <button class="btn btn-sm btn-outline-secondary" onclick="loadAllCalls()">View All</button>
                </div>
                <div class="card-body p-0">
                    ${active.length > 0 ? `
                        <div class="list-group list-group-flush">
                            ${active.slice(0, 8).map(c => renderCallRow(c)).join('')}
                        </div>
                    ` : `<div class="text-center py-5 text-muted">
                        <i class="fas fa-phone-slash fa-3x mb-3 d-block"></i>
                        <h6>No active calls</h6>
                        <p class="small mb-0">All hotline calls are resolved.</p>
                    </div>`}
                </div>
            </div>
        `;
    } catch (err) {
        console.error('Dashboard error:', err);
        container.innerHTML = '<div class="alert alert-danger">Error loading dashboard: ' + err.message + '</div>';
    }
}

// ============================================
// RENDER CALL ROW — FIXED: type icon always, FB badge in corner
// ============================================
function renderCallRow(call) {
    const priority = call.priority || 'medium';
    const status = call.status || 'pending';
    const typeClass = getTypeClass(call.emergency_type);
    const typeIcon = getTypeIcon(call.emergency_type);
    const timeAgo = getTimeAgo(call.created_at);
    const isFB = isFacebookCall(call);
    const pulse = getPriorityPulseClasses(priority);

    return `
        <div class="list-group-item hotline-row priority-${priority} ${pulse.card}"
             style="cursor:pointer;" onclick="openCallDetail('${call.id}')">
            <div class="d-flex align-items-center gap-3">
                <span class="badge priority-${priority}">${priority}</span>
                <div class="incident-type-icon ${typeClass} ${pulse.icon}" style="position:relative;">
                    <i class="fas ${typeIcon}"></i>
                    ${isFB ? '<span class="fb-corner-badge"><i class="fab fa-facebook-messenger"></i></span>' : ''}
                </div>
                <div class="flex-grow-1" style="min-width:0;">
                    <div class="fw-semibold text-truncate d-flex align-items-center gap-2 flex-wrap">
                        <span>${escapeHtml(call.caller_name || 'Unknown')}</span>
                    </div>
                    <div class="small text-muted text-truncate">
                        <i class="fas ${typeIcon} me-1"></i>${escapeHtml(call.emergency_type || 'unknown')}
                        <span class="mx-2">•</span>
                        <i class="fas fa-map-marker-alt me-1"></i>${escapeHtml(call.incident_location || 'Location not set')}
                        <span class="mx-2">•</span>
                        <i class="fas fa-clock me-1"></i>${timeAgo}
                    </div>
                </div>
                <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
                <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation();openCallDetail('${call.id}')">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        </div>
    `;
}

// ============================================
// NEW CALL MODAL
// ============================================
function openNewCallModal() {
    const form = document.getElementById('newCallForm');
    if (form) form.reset();
    activeCallSeconds = 0;
    const timerEl = document.getElementById('callDurationDisplay');
    if (timerEl) timerEl.textContent = '00:00';
    if (newCallModal) newCallModal.show();
}

function startCallTimer() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        const modalEl = document.getElementById('newCallModal');
        if (modalEl && modalEl.classList.contains('show')) {
            activeCallSeconds++;
            const m = Math.floor(activeCallSeconds / 60);
            const s = activeCallSeconds % 60;
            const el = document.getElementById('callDurationDisplay');
            if (el) el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
    }, 1000);
}

async function submitNewCall() {
    const callerName = document.getElementById('callCallerName').value.trim();
    const callerContact = document.getElementById('callCallerContact').value.trim();
    const callerAddress = document.getElementById('callCallerAddress').value.trim();
    const callType = document.getElementById('callType').value;
    const emergencyType = document.getElementById('callEmergencyType').value;
    const location = document.getElementById('callLocation').value.trim();
    const description = document.getElementById('callDescription').value.trim();
    const priority = document.getElementById('callPriority').value;

    if (!callerName || !callerContact || !location || !description) {
        showToast('Please fill in all required fields', 'warning');
        return;
    }

    const btn = document.getElementById('submitCallBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logging...';

    try {
        let emergencyId = null;
        if (priority === 'critical' || priority === 'high') {
            const { data: emergency, error: emErr } = await supabaseClient
                .from('emergencies')
                .insert([{
                    type: emergencyType === 'crime' ? 'armed_conflict' : emergencyType,
                    priority: priority,
                    status: 'reported',
                    title: `[HOTLINE] ${emergencyType.toUpperCase()} - ${location}`,
                    description: description + `\n\nCaller: ${callerName} (${callerContact})`,
                    location: { address: location },
                    reporter_name: callerName,
                    reporter_phone: callerContact,
                    source: 'hotline',
                    verified_status: 'pending'
                }])
                .select()
                .single();

            if (emErr) console.warn('Emergency creation failed:', emErr);
            else emergencyId = emergency.id;
        }

        const { data, error } = await supabaseClient
            .from('hotline_calls')
            .insert([{
                caller_number: callerContact,
                caller_name: callerName,
                caller_address: callerAddress || null,
                description: description,
                emergency_type: emergencyType,
                incident_location: location,
                priority: priority,
                status: 'pending',
                call_type: callType,
                duration: activeCallSeconds,
                assigned_to: currentUser.id,
                emergency_id: emergencyId
            }])
            .select()
            .single();

        if (error) throw error;

        await supabaseClient.from('hotline_communication_log').insert([{
            hotline_call_id: data.id,
            action: 'call_received',
            performed_by: currentUser.id,
            new_status: 'pending',
            message: `Call logged by ${currentProfile.full_name}`
        }]);

        showToast('✅ Call logged successfully!', 'success');
        if (emergencyId) showToast('📢 Auto-dispatched to responders!', 'info', 4000);

        if (newCallModal) newCallModal.hide();
        activeCallSeconds = 0;
        await loadHotlineDashboard();

    } catch (err) {
        console.error('Submit call error:', err);
        showToast('Failed to log call: ' + err.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// ============================================
// CALL DETAIL MODAL
// ============================================
async function openCallDetail(callId) {
    try {
        const { data: call } = await supabaseClient
            .from('hotline_calls').select('*').eq('id', callId).maybeSingle();
        if (!call) { showToast('Call not found', 'warning'); return; }

        const { data: logs } = await supabaseClient
            .from('hotline_communication_log')
            .select('*').eq('hotline_call_id', callId)
            .order('created_at', { ascending: true });

        const titleEl = document.getElementById('callDetailTitle');
        const bodyEl = document.getElementById('callDetailBody');
        const footerEl = document.getElementById('callDetailFooter');

        const typeClass = getTypeClass(call.emergency_type);
        const typeIcon = getTypeIcon(call.emergency_type);
        const typeLabel = getTypeLabel(call.emergency_type);
        const isFB = isFacebookCall(call);
        const pulse = getPriorityPulseClasses(call.priority);

        if (titleEl) titleEl.innerHTML = `<i class="fas ${typeIcon}"></i> Call #${call.id.substring(0, 8)}`;

        bodyEl.innerHTML = `
            <div class="d-flex gap-2 mb-3 flex-wrap align-items-center">
                <span class="badge priority-${call.priority}">${call.priority} priority</span>
                <span class="status-badge status-${call.status}">${call.status.replace('_', ' ')}</span>
                <span class="hotline-type-chip ${typeClass}"><i class="fas ${typeIcon}"></i> ${typeLabel}</span>
                <span class="badge ${isFB ? 'bg-primary' : 'bg-secondary'}">
                    <i class="${isFB ? 'fab fa-facebook-messenger' : 'fas fa-phone'} me-1"></i>${call.call_type || 'incoming'}
                </span>
            </div>

            <div class="d-flex align-items-center gap-3 mb-3">
                <div class="incident-type-icon ${typeClass} ${pulse.icon}" style="width:56px;height:56px;font-size:1.4rem;position:relative;">
                    <i class="fas ${typeIcon}"></i>
                    ${isFB ? '<span class="fb-corner-badge" style="width:20px;height:20px;font-size:0.7rem;"><i class="fab fa-facebook-messenger"></i></span>' : ''}
                </div>
                <div>
                    <div class="fw-bold" style="font-family:'Sora',sans-serif;">${escapeHtml(call.caller_name || 'Unknown')}</div>
                    <div class="small text-muted">${escapeHtml(call.caller_number || 'N/A')}</div>
                </div>
            </div>

            <div class="row g-3 mb-3">
                ${call.caller_address ? `
                <div class="col-md-6">
                    <div class="detail-meta-item">
                        <div class="lbl"><i class="fas fa-home me-1"></i>Caller Address</div>
                        <div class="val">${escapeHtml(call.caller_address)}</div>
                    </div>
                </div>` : ''}
                <div class="col-md-6">
                    <div class="detail-meta-item">
                        <div class="lbl"><i class="fas fa-tag me-1"></i>Emergency Type</div>
                        <div class="val text-capitalize">${escapeHtml(call.emergency_type || 'Unknown')}</div>
                    </div>
                </div>
                <div class="col-12">
                    <div class="detail-meta-item">
                        <div class="lbl"><i class="fas fa-map-marker-alt me-1"></i>Incident Location</div>
                        <div class="val">${escapeHtml(call.incident_location || 'Location not set')}</div>
                    </div>
                </div>
                <div class="col-12">
                    <div class="detail-meta-item">
                        <div class="lbl"><i class="fas fa-clock me-1"></i>Reported At</div>
                        <div class="val">${new Date(call.created_at).toLocaleString()}</div>
                    </div>
                </div>
            </div>

            <div class="detail-section-title mb-2"><i class="fas fa-align-left me-1"></i>Description</div>
            <div class="detail-desc">${escapeHtml(call.description || 'No description provided')}</div>

            ${call.notes ? `
            <div class="detail-section-title mb-2 mt-3"><i class="fas fa-sticky-note me-1"></i>Operator Notes</div>
            <div class="detail-desc">${escapeHtml(call.notes)}</div>` : ''}

            <div class="detail-section-title mb-2 mt-3"><i class="fas fa-stream me-1"></i>Communication Log</div>
            <div class="detail-timeline">
                ${(logs || []).map(l => `
                    <div class="tl-item">
                        <span class="tl-dot active"></span>
                        <div class="tl-label">${escapeHtml(l.action.replace(/_/g, ' '))}</div>
                        <div class="tl-time">${new Date(l.created_at).toLocaleString()} ${l.message ? '· ' + escapeHtml(l.message) : ''}</div>
                    </div>
                `).join('') || '<div class="small text-muted">No log entries yet.</div>'}
            </div>

            <div class="detail-section-title mb-2 mt-3"><i class="fas fa-edit me-1"></i>Update Status</div>
            <div class="row g-2">
                <div class="col-md-6">
                    <select class="form-select" id="updateCallStatus">
                        <option value="pending" ${call.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="received" ${call.status === 'received' ? 'selected' : ''}>Received</option>
                        <option value="verifying" ${call.status === 'verifying' ? 'selected' : ''}>Verifying</option>
                        <option value="verified" ${call.status === 'verified' ? 'selected' : ''}>Verified</option>
                        <option value="assigned" ${call.status === 'assigned' ? 'selected' : ''}>Assigned</option>
                        <option value="responding" ${call.status === 'responding' ? 'selected' : ''}>Responding</option>
                        <option value="processed" ${call.status === 'processed' ? 'selected' : ''}>Processed</option>
                        <option value="resolved" ${call.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                        <option value="closed" ${call.status === 'closed' ? 'selected' : ''}>Closed</option>
                        <option value="cancelled" ${call.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        <option value="false_alarm" ${call.status === 'false_alarm' ? 'selected' : ''}>False Alarm</option>
                        <option value="missed" ${call.status === 'missed' ? 'selected' : ''}>Missed</option>
                    </select>
                </div>
                <div class="col-md-6">
                    <select class="form-select" id="updateCallPriority">
                        <option value="critical" ${call.priority === 'critical' ? 'selected' : ''}>Critical</option>
                        <option value="high" ${call.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${call.priority === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="low" ${call.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                </div>
                <div class="col-12">
                    <textarea class="form-control" id="updateCallNotes" rows="2" placeholder="Add notes...">${escapeHtml(call.notes || '')}</textarea>
                </div>
            </div>
        `;

        footerEl.innerHTML = `
            ${call.emergency_id ? `
                <button class="btn btn-outline-primary me-auto" onclick="window.open('dashboard.html', '_blank')">
                    <i class="fas fa-external-link-alt me-1"></i>View Emergency
                </button>
            ` : ''}
            <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button class="btn btn-primary" onclick="updateCallDetails('${call.id}')">
                <i class="fas fa-save me-1"></i>Save Changes
            </button>
        `;

        if (callDetailModal) callDetailModal.show();
    } catch (err) {
        console.error('Open call detail error:', err);
        showToast('Failed to load call details', 'danger');
    }
}

async function updateCallDetails(callId) {
    const status = document.getElementById('updateCallStatus').value;
    const priority = document.getElementById('updateCallPriority').value;
    const notes = document.getElementById('updateCallNotes').value.trim();

    try {
        const { data: before } = await supabaseClient
            .from('hotline_calls').select('status').eq('id', callId).maybeSingle();

        const updateData = { status, priority, notes, updated_at: new Date().toISOString() };
        const now = new Date().toISOString();

        if (status === 'verified') { updateData.verified_by = currentUser.id; updateData.acknowledged_at = now; }
        if (status === 'assigned') { updateData.assigned_at = now; }
        if (status === 'responding') { updateData.responded_at = now; }
        if (status === 'resolved') { updateData.resolved_at = now; }
        if (status === 'closed') { updateData.closed_at = now; }

        const { error } = await supabaseClient.from('hotline_calls').update(updateData).eq('id', callId);
        if (error) throw error;

        await supabaseClient.from('hotline_communication_log').insert([{
            hotline_call_id: callId,
            action: 'status_update',
            performed_by: currentUser.id,
            old_status: before?.status,
            new_status: status,
            message: notes ? `Note: ${notes}` : `Updated to ${status}`
        }]);

        showToast('✅ Call updated!', 'success');
        if (callDetailModal) callDetailModal.hide();
        await loadHotlineDashboard();
    } catch (err) {
        console.error('Update call error:', err);
        showToast('Failed to update: ' + err.message, 'danger');
    }
}

// ============================================
// ALL CALLS / ACTIVE / HISTORY
// ============================================
async function loadAllCalls() {
    const container = document.getElementById('pageContent');
    try {
        const { data: calls } = await supabaseClient
            .from('hotline_calls').select('*').order('created_at', { ascending: false });
        allCalls = calls || [];

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
                <h4 class="fw-bold mb-0"><i class="fas fa-list me-2"></i>All Hotline Calls</h4>
                <button class="btn btn-success" onclick="openNewCallModal()"><i class="fas fa-phone me-2"></i>Log Call</button>
            </div>
            <div class="incidents-filter-bar">
                <div class="row g-2">
                    <div class="col-md-4">
                        <input type="text" class="form-control form-control-sm" id="hotlineSearch" placeholder="Search caller, location..." oninput="filterCalls()">
                    </div>
                    <div class="col-md-3">
                        <select class="form-select form-select-sm" id="hotlineStatusFilter" onchange="filterCalls()">
                            <option value="">All Statuses</option>
                            <option value="pending">Pending</option>
                            <option value="received">Received</option>
                            <option value="verifying">Verifying</option>
                            <option value="verified">Verified</option>
                            <option value="assigned">Assigned</option>
                            <option value="responding">Responding</option>
                            <option value="processed">Processed</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <select class="form-select form-select-sm" id="hotlinePriorityFilter" onchange="filterCalls()">
                            <option value="">All Priorities</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <button class="btn btn-sm btn-outline-secondary w-100" onclick="resetCallFilters()"><i class="fas fa-redo"></i></button>
                    </div>
                </div>
            </div>
            <div id="callsList">
                ${allCalls.length > 0
                    ? allCalls.map(c => renderCallCard(c)).join('')
                    : '<div class="text-center py-5 text-muted"><i class="fas fa-phone-slash fa-3x mb-3 d-block"></i><h6>No calls logged yet</h6></div>'}
            </div>
        `;
    } catch (err) {
        container.innerHTML = '<div class="alert alert-danger">Error loading calls</div>';
    }
}

// ============================================
// RENDER CALL CARD — FIXED
// ============================================
function renderCallCard(call) {
    const priority = call.priority || 'medium';
    const status = call.status || 'pending';
    const isFB = isFacebookCall(call);
    const typeClass = getTypeClass(call.emergency_type);
    const typeIcon = getTypeIcon(call.emergency_type);
    const pulse = getPriorityPulseClasses(priority);

    return `
        <div class="incident-card priority-${priority} ${pulse.card}"
             data-search="${((call.caller_name || '') + ' ' + (call.incident_location || '') + ' ' + (call.emergency_type || '')).toLowerCase()}"
             data-status="${status}" data-priority="${priority}">
            <div class="incident-card-header">
                <div class="d-flex align-items-start gap-3 flex-grow-1" style="min-width:0;">
                    <div class="incident-type-icon ${typeClass} ${pulse.icon}" style="position:relative;">
                        <i class="fas ${typeIcon}"></i>
                        ${isFB ? '<span class="fb-corner-badge"><i class="fab fa-facebook-messenger"></i></span>' : ''}
                    </div>
                    <div style="min-width:0;flex:1;">
                        <div class="incident-card-title">
                            <span>${escapeHtml(call.caller_name || 'Unknown')}</span>
                        </div>
                        <div class="incident-card-meta">
                            <span><i class="fas ${typeIcon}"></i>${escapeHtml(call.emergency_type || 'unknown')}</span>
                            <span><i class="fas fa-map-marker-alt"></i>${escapeHtml(call.incident_location || 'N/A')}</span>
                            <span><i class="fas fa-clock"></i>${new Date(call.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
                <div class="d-flex flex-column align-items-end gap-2 flex-shrink-0">
                    <span class="badge priority-${priority}">${priority}</span>
                    <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
                </div>
            </div>
            <div class="incident-card-body">
                <div class="incident-description-box">
                    <span class="desc-label"><i class="fas fa-align-left me-1"></i>Description</span>
                    <span class="desc-text">${escapeHtml(call.description || 'No description')}</span>
                </div>
                <div class="small text-muted mt-2">
                    <i class="fas fa-phone me-1"></i>${escapeHtml(call.caller_number || 'N/A')}
                    ${call.duration ? `<span class="ms-3"><i class="fas fa-clock me-1"></i>Duration: ${Math.floor(call.duration / 60)}m ${call.duration % 60}s</span>` : ''}
                </div>
            </div>
            <div class="incident-card-footer">
                <div class="small" style="color:var(--muted-foreground);"><i class="fas fa-hashtag me-1"></i>${call.id.substring(0, 8)}</div>
                <button class="btn-incident-action btn-primary" onclick="openCallDetail('${call.id}')">
                    <i class="fas fa-eye"></i> Manage
                </button>
            </div>
        </div>
    `;
}

function filterCalls() {
    const search = (document.getElementById('hotlineSearch')?.value || '').toLowerCase();
    const status = document.getElementById('hotlineStatusFilter')?.value || '';
    const priority = document.getElementById('hotlinePriorityFilter')?.value || '';

    document.querySelectorAll('#callsList .incident-card').forEach(card => {
        const cardSearch = card.getAttribute('data-search') || '';
        const cardStatus = card.getAttribute('data-status') || '';
        const cardPriority = card.getAttribute('data-priority') || '';
        const show = (!search || cardSearch.includes(search)) &&
                     (!status || cardStatus === status) &&
                     (!priority || cardPriority === priority);
        card.style.display = show ? '' : 'none';
    });
}

function resetCallFilters() {
    const s = document.getElementById('hotlineSearch'); if (s) s.value = '';
    const st = document.getElementById('hotlineStatusFilter'); if (st) st.value = '';
    const p = document.getElementById('hotlinePriorityFilter'); if (p) p.value = '';
    filterCalls();
}

async function loadActiveCalls() {
    const container = document.getElementById('pageContent');
    const { data: calls } = await supabaseClient
        .from('hotline_calls').select('*')
        .in('status', ['pending', 'received', 'verifying', 'verified', 'assigned', 'responding'])
        .order('created_at', { ascending: false });

    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-hourglass-half me-2"></i>Active Calls (${(calls || []).length})</h4>
        ${(calls || []).length > 0
            ? (calls || []).map(c => renderCallCard(c)).join('')
            : '<div class="text-center py-5 text-muted"><i class="fas fa-check-circle fa-3x mb-3 d-block text-success"></i><h6>No active calls</h6></div>'}
    `;
}

async function loadCallHistory() {
    const container = document.getElementById('pageContent');
    const { data: calls } = await supabaseClient
        .from('hotline_calls').select('*')
        .in('status', ['resolved', 'closed', 'processed', 'cancelled', 'missed', 'false_alarm'])
        .order('created_at', { ascending: false });

    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-history me-2"></i>Call History (${(calls || []).length})</h4>
        ${(calls || []).length > 0
            ? (calls || []).map(c => renderCallCard(c)).join('')
            : '<div class="text-center py-5 text-muted"><i class="fas fa-inbox fa-3x mb-3 d-block"></i><h6>No closed calls yet</h6></div>'}
    `;
}

async function loadOperators() {
    const container = document.getElementById('pageContent');
    const { data: ops } = await supabaseClient
        .from('hotline_operators').select('*, profiles:user_id(full_name, email, contact_number, role)');

    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-headset me-2"></i>Hotline Operators (${(ops || []).length})</h4>
        ${(ops || []).length > 0 ? `
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead><tr><th>Name</th><th>Email</th><th>Shift</th><th>Station</th><th>Status</th><th>Since</th></tr></thead>
                    <tbody>
                        ${ops.map(o => `<tr>
                            <td>${escapeHtml(o.profiles?.full_name || 'N/A')}</td>
                            <td>${escapeHtml(o.profiles?.email || 'N/A')}</td>
                            <td><span class="badge bg-primary text-capitalize">${o.shift}</span></td>
                            <td>${escapeHtml(o.station || 'N/A')}</td>
                            <td>${o.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'}</td>
                            <td>${new Date(o.created_at).toLocaleDateString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        ` : '<div class="text-center py-5 text-muted"><i class="fas fa-user-slash fa-3x mb-3 d-block"></i><h6>No operators registered</h6></div>'}
    `;
}

function loadHotlineProfile() {
    const container = document.getElementById('pageContent');
    container.innerHTML = `
        <h4 class="fw-bold mb-4"><i class="fas fa-user me-2"></i>Operator Profile</h4>
        <div class="card"><div class="card-body">
            <div class="row g-3">
                <div class="col-md-6"><label class="text-muted small">Name</label><p class="fw-semibold">${escapeHtml(currentProfile?.full_name || '')}</p></div>
                <div class="col-md-6"><label class="text-muted small">Email</label><p class="fw-semibold">${escapeHtml(currentUser?.email || '')}</p></div>
                <div class="col-md-6"><label class="text-muted small">Current Shift</label><p class="fw-semibold text-capitalize">${getCurrentShift()}</p></div>
                <div class="col-md-6"><label class="text-muted small">Role</label><p class="fw-semibold"><span class="badge bg-danger">${currentProfile?.role}</span></p></div>
            </div>
        </div></div>
    `;
}

// ============================================
// REALTIME
// ============================================
function setupHotlineRealtime() {
    if (hotlineRealtimeChannel) {
        try { supabaseClient.removeChannel(hotlineRealtimeChannel); } catch (e) {}
    }
    hotlineRealtimeChannel = supabaseClient
        .channel('hotline-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hotline_calls' }, payload => {
            if (!payload.new) return;
            const name = payload.new.caller_name || 'Unknown';
            showToast(`📞 New call: ${name}`, 'warning', 6000);
            const activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
            if (activePage === 'dashboard' || activePage === 'all-calls') loadHotlineDashboard();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hotline_calls' }, payload => {
            const activePage = document.querySelector('.dashboard-sidebar .nav-link.active')?.dataset?.page;
            if (activePage === 'dashboard' || activePage === 'all-calls') loadHotlineDashboard();
        })
        .subscribe();
}

// ============================================
// HELPERS
// ============================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getTimeAgo(dateStr) {
    if (!dateStr) return 'just now';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toastContainer') || (() => {
        const c = document.createElement('div');
        c.className = 'toast-container'; c.id = 'toastContainer';
        document.body.appendChild(c); return c;
    })();
    const colors = { success: 'bg-success text-white', danger: 'bg-danger text-white', warning: 'bg-warning text-dark', info: 'bg-info text-white' };
    const icons = { success: 'check-circle', danger: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const t = document.createElement('div');
    t.className = 'toast align-items-center ' + (colors[type] || colors.info) + ' border-0';
    t.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="fas fa-${icons[type] || 'info-circle'} me-2"></i>${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(t);
    const bs = new bootstrap.Toast(t, { autohide: true, delay: duration });
    bs.show();
    setTimeout(() => t.remove(), duration + 500);
}

async function hotlineLogout() {
    try {
        if (hotlineRealtimeChannel) { try { await supabaseClient.removeChannel(hotlineRealtimeChannel); } catch (e) {} }
        await supabaseClient.auth.signOut();
    } catch (e) {}
    window.location.href = '../index.html';
}

// ============================================
// EXPOSE
// ============================================
window.openNewCallModal = openNewCallModal;
window.submitNewCall = submitNewCall;
window.openCallDetail = openCallDetail;
window.updateCallDetails = updateCallDetails;
window.filterCalls = filterCalls;
window.resetCallFilters = resetCallFilters;
window.loadHotlineDashboard = loadHotlineDashboard;
window.loadAllCalls = loadAllCalls;
window.loadActiveCalls = loadActiveCalls;
window.loadCallHistory = loadCallHistory;
window.loadOperators = loadOperators;
window.loadHotlinePage = loadHotlinePage;
window.hotlineLogout = hotlineLogout;

document.addEventListener('DOMContentLoaded', initHotlineDashboard);
