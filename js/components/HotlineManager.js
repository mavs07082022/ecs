// js/components/HotlineManager.js

class HotlineManager {
    constructor() {
        this.container = document.getElementById('pageContent');
        this.calls = [];
        this.subscription = null;
    }

    // ============================================
    // RENDER
    // ============================================
    async render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h4><i class="fas fa-phone-volume text-danger me-2"></i>Hotline Management</h4>
                    <p class="text-muted small">Manage incoming emergency calls</p>
                </div>
                <div>
                    <button class="btn btn-success btn-sm" onclick="window.HotlineManager.simulateCall()">
                        <i class="fas fa-phone me-1"></i>Simulate Call
                    </button>
                </div>
            </div>

            <!-- Stats -->
            <div class="row g-4 mb-4" id="hotlineStats">
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="totalCalls">0</div>
                                <div class="stat-label">Total Calls</div>
                            </div>
                            <div class="stat-icon bg-primary bg-opacity-10 text-primary">
                                <i class="fas fa-phone"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="pendingCalls">0</div>
                                <div class="stat-label">Pending</div>
                            </div>
                            <div class="stat-icon bg-warning bg-opacity-10 text-warning">
                                <i class="fas fa-clock"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="resolvedCalls">0</div>
                                <div class="stat-label">Resolved</div>
                            </div>
                            <div class="stat-icon bg-success bg-opacity-10 text-success">
                                <i class="fas fa-check-circle"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="criticalCalls">0</div>
                                <div class="stat-label">Critical</div>
                            </div>
                            <div class="stat-icon bg-danger bg-opacity-10 text-danger">
                                <i class="fas fa-triangle-exclamation"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Call Log -->
            <div class="card-modern">
                <div class="card-header">
                    <h6 class="mb-0"><i class="fas fa-list me-2"></i>Call Log</h6>
                </div>
                <div class="card-body p-0">
                    <div id="callLogList" class="list-group list-group-flush">
                        <div class="text-center py-4 text-muted">
                            <i class="fas fa-phone fa-2x mb-2 d-block"></i>
                            No calls logged yet
                        </div>
                    </div>
                </div>
            </div>
        `;

        await this.loadData();
        this.setupRealtime();
    }

    // ============================================
    // LOAD DATA
    // ============================================
    async loadData() {
        this.calls = await window.HotlineService.getCalls();
        this.renderStats();
        this.renderCallLog();
    }

    // ============================================
    // RENDER STATS
    // ============================================
    renderStats() {
        const total = this.calls.length;
        const pending = this.calls.filter(c => c.status === 'pending').length;
        const resolved = this.calls.filter(c => c.status === 'resolved').length;
        const critical = this.calls.filter(c => c.priority === 'critical').length;

        document.getElementById('totalCalls').textContent = total;
        document.getElementById('pendingCalls').textContent = pending;
        document.getElementById('resolvedCalls').textContent = resolved;
        document.getElementById('criticalCalls').textContent = critical;
    }

    // ============================================
    // RENDER CALL LOG
    // ============================================
    renderCallLog() {
        const container = document.getElementById('callLogList');
        if (!container) return;

        if (this.calls.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <i class="fas fa-phone fa-2x mb-2 d-block"></i>
                    No calls logged yet
                </div>
            `;
            return;
        }

        container.innerHTML = this.calls.slice(0, 20).map(call => `
            <div class="list-group-item d-flex align-items-center gap-3 py-3">
                <div class="flex-shrink-0">
                    <span class="badge ${this.getPriorityClass(call.priority)}">
                        ${call.priority}
                    </span>
                </div>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${call.caller_name || 'Unknown'}</div>
                    <div class="small text-muted">
                        ${call.caller_number} • ${call.emergency_type || 'General'} • ${new Date(call.created_at).toLocaleString()}
                    </div>
                    <div class="small">${call.description || 'No description'}</div>
                </div>
                <div>
                    <span class="badge ${this.getStatusClass(call.status)}">
                        ${call.status}
                    </span>
                </div>
                <div>
                    <button class="btn btn-sm btn-outline-primary" onclick="window.HotlineManager.viewCall('${call.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // VIEW CALL
    // ============================================
    viewCall(id) {
        const call = this.calls.find(c => c.id === id);
        if (!call) return;

        const modalHTML = `
            <div class="modal fade" id="callModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-phone me-2"></i>Call Details
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-2"><strong>Caller:</strong> ${call.caller_name || 'Unknown'}</div>
                            <div class="mb-2"><strong>Number:</strong> ${call.caller_number}</div>
                            <div class="mb-2"><strong>Type:</strong> ${call.emergency_type || 'General'}</div>
                            <div class="mb-2"><strong>Priority:</strong> <span class="badge ${this.getPriorityClass(call.priority)}">${call.priority}</span></div>
                            <div class="mb-2"><strong>Status:</strong> <span class="badge ${this.getStatusClass(call.status)}">${call.status}</span></div>
                            <div class="mb-2"><strong>Time:</strong> ${new Date(call.created_at).toLocaleString()}</div>
                            ${call.notes ? `<div class="mb-2"><strong>Notes:</strong> ${call.notes}</div>` : ''}
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-success" onclick="window.HotlineManager.resolveCall('${call.id}')">
                                <i class="fas fa-check me-1"></i>Resolve
                            </button>
                            <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal
        document.querySelector('#callModal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        const modal = new bootstrap.Modal(document.getElementById('callModal'));
        modal.show();
    }

    // ============================================
    // RESOLVE CALL
    // ============================================
    async resolveCall(id) {
        try {
            await window.HotlineService.updateCallStatus(id, 'resolved', 'Resolved by dispatcher');
            await this.loadData();
            this.renderStats();
            this.renderCallLog();
            
            const modal = document.getElementById('callModal');
            if (modal) bootstrap.Modal.getInstance(modal)?.hide();
            
            showNotification('Call Resolved', 'The call has been marked as resolved', 'success');
        } catch (error) {
            console.error('Error resolving call:', error);
            showNotification('Error', 'Failed to resolve call', 'error');
        }
    }

    // ============================================
    // SIMULATE CALL
    // ============================================
    simulateCall() {
        const names = ['Juan Dela Cruz', 'Maria Santos', 'Jose Reyes', 'Ana Garcia', 'Carlos Mendoza'];
        const emergencies = ['Fire', 'Medical', 'Accident', 'Flood', 'Security', 'Other'];
        const name = names[Math.floor(Math.random() * names.length)];
        const number = '09' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
        const emergencyType = emergencies[Math.floor(Math.random() * emergencies.length)];
        const description = `${emergencyType} emergency reported at Barangay ${Math.floor(Math.random() * 10) + 1}`;

        window.HotlineService.simulateIncomingCall(number, name, description, emergencyType.toLowerCase());
        
        setTimeout(() => {
            this.loadData();
        }, 1000);

        showNotification('📞 Simulated Call', `${name} from ${number}`, 'info');
    }

    // ============================================
    // HELPERS
    // ============================================
    getPriorityClass(priority) {
        const classes = {
            critical: 'bg-danger text-white',
            high: 'bg-warning text-dark',
            medium: 'bg-info text-dark',
            low: 'bg-secondary text-white'
        };
        return classes[priority] || 'bg-secondary';
    }

    getStatusClass(status) {
        const classes = {
            pending: 'bg-warning text-dark',
            processed: 'bg-info text-dark',
            resolved: 'bg-success text-white',
            missed: 'bg-secondary text-white'
        };
        return classes[status] || 'bg-secondary';
    }

    // ============================================
    // REALTIME
    // ============================================
    setupRealtime() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }

        // Listen for new calls
        this.subscription = window.supabase
            .channel('hotline-changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'hotline_calls'
            }, (payload) => {
                this.loadData();
            })
            .subscribe();
    }

    // ============================================
    // DESTROY
    // ============================================
    destroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
    }
}

// Make global
window.HotlineManager = new HotlineManager();