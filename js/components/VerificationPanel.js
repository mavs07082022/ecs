// js/components/VerificationPanel.js

class VerificationPanel {
    constructor() {
        this.container = document.getElementById('pageContent');
        this.emergencies = [];
        this.subscription = null;
    }

    // ============================================
    // RENDER
    // ============================================
    async render() {
        if (!this.container) return;

        // Check if user has permission
        const profile = window.Auth.getCurrentUserProfile();
        if (!profile || !['responder', 'dispatcher', 'admin'].includes(profile.role)) {
            this.container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-lock fa-3x text-muted mb-3"></i>
                    <h4>Access Restricted</h4>
                    <p class="text-muted">Only responders, dispatchers, and admins can verify emergencies.</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h4><i class="fas fa-check-double text-danger me-2"></i>Incident Verification</h4>
                    <p class="text-muted small">Review and verify emergency reports</p>
                </div>
                <div>
                    <button class="btn btn-outline-secondary btn-sm" onclick="window.VerificationPanel.refresh()">
                        <i class="fas fa-refresh me-1"></i>Refresh
                    </button>
                </div>
            </div>

            <!-- Stats -->
            <div class="row g-4 mb-4">
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="pendingCount">0</div>
                                <div class="stat-label">Pending Verification</div>
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
                                <div class="stat-number" id="verifiedCount">0</div>
                                <div class="stat-label">Verified</div>
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
                                <div class="stat-number" id="fakeCount">0</div>
                                <div class="stat-label">Marked Fake</div>
                            </div>
                            <div class="stat-icon bg-danger bg-opacity-10 text-danger">
                                <i class="fas fa-ban"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number" id="duplicateCount">0</div>
                                <div class="stat-label">Duplicates</div>
                            </div>
                            <div class="stat-icon bg-info bg-opacity-10 text-info">
                                <i class="fas fa-copy"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Verification List -->
            <div class="card-modern">
                <div class="card-header">
                    <h6 class="mb-0"><i class="fas fa-list me-2"></i>Reports Awaiting Verification</h6>
                </div>
                <div class="card-body p-0">
                    <div id="verificationList" class="list-group list-group-flush">
                        <div class="text-center py-4 text-muted">
                            <i class="fas fa-check-circle fa-2x mb-2 d-block text-success"></i>
                            No reports pending verification
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
        // Get all emergencies that need verification
        const all = await window.EmergencyService.getEmergencyReports();
        this.emergencies = all.filter(e => 
            e.status === 'reported' || 
            e.status === 'acknowledged' || 
            e.verified_status === 'pending'
        );
        this.renderStats();
        this.renderList();
    }

    // ============================================
    // RENDER STATS
    // ============================================
    renderStats() {
        const pending = this.emergencies.filter(e => e.verified_status === 'pending' || !e.verified_status).length;
        const verified = this.emergencies.filter(e => e.verified_status === 'verified').length;
        const fake = this.emergencies.filter(e => e.verified_status === 'fake').length;
        const duplicate = this.emergencies.filter(e => e.verified_status === 'duplicate').length;

        document.getElementById('pendingCount').textContent = pending;
        document.getElementById('verifiedCount').textContent = verified;
        document.getElementById('fakeCount').textContent = fake;
        document.getElementById('duplicateCount').textContent = duplicate;
    }

    // ============================================
    // RENDER LIST
    // ============================================
    renderList() {
        const container = document.getElementById('verificationList');
        if (!container) return;

        const pending = this.emergencies.filter(e => e.verified_status === 'pending' || !e.verified_status);

        if (pending.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <i class="fas fa-check-circle fa-2x mb-2 d-block text-success"></i>
                    No reports pending verification
                </div>
            `;
            return;
        }

        container.innerHTML = pending.map(emergency => `
            <div class="list-group-item py-3">
                <div class="d-flex flex-wrap align-items-start gap-3">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                            <span class="fw-semibold">${emergency.title}</span>
                            <span class="badge ${this.getPriorityClass(emergency.priority)}">${emergency.priority}</span>
                            <span class="badge ${this.getStatusClass(emergency.status)}">${this.getStatusLabel(emergency.status)}</span>
                            <span class="badge bg-secondary">${emergency.source || 'app'}</span>
                        </div>
                        <p class="small text-muted mb-1">${emergency.description}</p>
                        <div class="small text-muted">
                            ${emergency.type} • ${emergency.reporter_name || 'Anonymous'} • ${new Date(emergency.created_at).toLocaleString()}
                        </div>
                    </div>
                    <div class="d-flex gap-2 flex-wrap">
                        <button class="btn btn-sm btn-success" onclick="window.VerificationPanel.verify('${emergency.id}', 'verified')">
                            <i class="fas fa-check me-1"></i>Verify
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="window.VerificationPanel.verify('${emergency.id}', 'fake')">
                            <i class="fas fa-ban me-1"></i>Fake
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="window.VerificationPanel.verify('${emergency.id}', 'duplicate')">
                            <i class="fas fa-copy me-1"></i>Duplicate
                        </button>
                        <button class="btn btn-sm btn-outline-info" onclick="window.VerificationPanel.viewDetails('${emergency.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // VERIFY
    // ============================================
    async verify(id, status) {
        try {
            const user = window.Auth.getCurrentUser();
            const profile = window.Auth.getCurrentUserProfile();
            
            const statusMap = {
                verified: 'verified',
                fake: 'fake',
                duplicate: 'duplicate'
            };

            // Get emergency details
            const emergency = this.emergencies.find(e => e.id === id);
            if (!emergency) return;

            // Confirm action
            const confirmMsg = status === 'verified' 
                ? `Are you sure you want to verify this emergency report?` 
                : `Are you sure you want to mark this as ${status}?`;

            if (!confirm(confirmMsg)) return;

            await window.EmergencyService.verifyEmergency(
                id,
                user.id,
                profile?.name || 'System',
                statusMap[status] || 'verified',
                `Report ${status} by ${profile?.name || 'System'}`
            );

            showNotification(
                `✅ Report ${status}`,
                `The emergency report has been marked as ${status}`,
                status === 'verified' ? 'success' : 'warning'
            );

            await this.loadData();

        } catch (error) {
            console.error('Verification error:', error);
            showNotification('Verification failed', error.message || 'Please try again', 'error');
        }
    }

    // ============================================
    // VIEW DETAILS
    // ============================================
    viewDetails(id) {
        const emergency = this.emergencies.find(e => e.id === id);
        if (!emergency) return;

        const modalHTML = `
            <div class="modal fade" id="detailModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-file-alt me-2"></i>Emergency Details
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <strong>Title</strong>
                                    <p>${emergency.title}</p>
                                </div>
                                <div class="col-md-6">
                                    <strong>Type</strong>
                                    <p>${emergency.type}</p>
                                </div>
                                <div class="col-md-6">
                                    <strong>Priority</strong>
                                    <p><span class="badge ${this.getPriorityClass(emergency.priority)}">${emergency.priority}</span></p>
                                </div>
                                <div class="col-md-6">
                                    <strong>Status</strong>
                                    <p><span class="badge ${this.getStatusClass(emergency.status)}">${this.getStatusLabel(emergency.status)}</span></p>
                                </div>
                                <div class="col-12">
                                    <strong>Description</strong>
                                    <p class="mt-1">${emergency.description}</p>
                                </div>
                                <div class="col-md-6">
                                    <strong>Reporter</strong>
                                    <p>${emergency.reporter_name || 'Anonymous'}</p>
                                </div>
                                <div class="col-md-6">
                                    <strong>Contact</strong>
                                    <p>${emergency.reporter_phone || 'Not provided'}</p>
                                </div>
                                <div class="col-12">
                                    <strong>Location</strong>
                                    <p>
                                        ${emergency.location?.address || ''}<br>
                                        ${emergency.location?.latitude || ''}, ${emergency.location?.longitude || ''}
                                    </p>
                                </div>
                                ${emergency.ai_classification ? `
                                <div class="col-12">
                                    <strong>AI Classification</strong>
                                    <div class="mt-1 p-2 bg-light rounded-3">
                                        <div>Type: ${emergency.ai_classification.type}</div>
                                        <div>Priority: ${emergency.ai_classification.priority}</div>
                                        <div>Confidence: ${Math.round(emergency.ai_classification.confidence * 100)}%</div>
                                        <div>Resources: ${emergency.ai_classification.suggestedResources?.join(', ') || 'None'}</div>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal
        document.querySelector('#detailModal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        const modal = new bootstrap.Modal(document.getElementById('detailModal'));
        modal.show();
    }

    // ============================================
    // REFRESH
    // ============================================
    async refresh() {
        await this.loadData();
        showNotification('Refreshed', 'Verification list updated', 'info');
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
            reported: 'status-reported',
            acknowledged: 'status-acknowledged',
            responding: 'status-responding',
            resolved: 'status-resolved',
            verified: 'status-verified',
            fake: 'status-fake',
            closed: 'status-closed'
        };
        return classes[status] || 'status-reported';
    }

    getStatusLabel(status) {
        const labels = {
            reported: 'Reported',
            acknowledged: 'Dispatched',
            responding: 'Responding',
            resolved: 'Resolved',
            verified: 'Verified',
            fake: 'Fake',
            closed: 'Closed'
        };
        return labels[status] || status;
    }

    // ============================================
    // REALTIME
    // ============================================
    setupRealtime() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }

        this.subscription = window.EmergencyService.subscribeToEmergencies((payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                this.loadData();
            }
        });
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
window.VerificationPanel = new VerificationPanel();