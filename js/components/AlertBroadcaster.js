// js/components/AlertBroadcaster.js

class AlertBroadcaster {
    constructor() {
        this.container = document.getElementById('pageContent');
        this.alerts = [];
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
                    <p class="text-muted">Only responders, dispatchers, and admins can broadcast alerts.</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h4><i class="fas fa-broadcast text-danger me-2"></i>Alert Broadcasting</h4>
                    <p class="text-muted small">Send emergency alerts to the community</p>
                </div>
            </div>

            <!-- Alert Form -->
            <div class="card-modern mb-4">
                <div class="card-header">
                    <h6 class="mb-0"><i class="fas fa-plus-circle me-2"></i>New Alert</h6>
                </div>
                <div class="card-body">
                    <form id="alertForm">
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Alert Title <span class="text-danger">*</span></label>
                            <input type="text" class="form-control form-control-modern" id="alertTitle" 
                                   placeholder="e.g., Typhoon Warning" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Message <span class="text-danger">*</span></label>
                            <textarea class="form-control form-control-modern" id="alertMessage" 
                                      rows="4" placeholder="Detailed alert message..." required></textarea>
                        </div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-4">
                                <label class="form-label fw-semibold">Type</label>
                                <select class="form-select form-control-modern" id="alertType">
                                    <option value="emergency">🚨 Emergency</option>
                                    <option value="warning">⚠️ Warning</option>
                                    <option value="advisory">ℹ️ Advisory</option>
                                    <option value="general">📢 General</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label fw-semibold">Priority</label>
                                <select class="form-select form-control-modern" id="alertPriority">
                                    <option value="critical">Critical</option>
                                    <option value="high">High</option>
                                    <option value="medium" selected>Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label fw-semibold">Channels</label>
                                <div class="d-flex gap-3 mt-2">
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="channelApp" checked>
                                        <label class="form-check-label small" for="channelApp">App</label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="channelSMS">
                                        <label class="form-check-label small" for="channelSMS">SMS</label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="channelEmail">
                                        <label class="form-check-label small" for="channelEmail">Email</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-emergency">
                            <i class="fas fa-broadcast me-2"></i>Send Alert
                        </button>
                    </form>
                </div>
            </div>

            <!-- Alert History -->
            <div class="card-modern">
                <div class="card-header">
                    <h6 class="mb-0"><i class="fas fa-history me-2"></i>Alert History</h6>
                </div>
                <div class="card-body p-0">
                    <div id="alertHistory" class="list-group list-group-flush">
                        <div class="text-center py-4 text-muted">
                            <i class="fas fa-broadcast fa-2x mb-2 d-block"></i>
                            No alerts sent yet
                        </div>
                    </div>
                </div>
            </div>
        `;

        await this.loadData();
        this.bindEvents();
    }

    // ============================================
    // LOAD DATA
    // ============================================
    async loadData() {
        this.alerts = await window.NotificationService.getAlerts();
        this.renderHistory();
    }

    // ============================================
    // RENDER HISTORY
    // ============================================
    renderHistory() {
        const container = document.getElementById('alertHistory');
        if (!container) return;

        if (this.alerts.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <i class="fas fa-broadcast fa-2x mb-2 d-block"></i>
                    No alerts sent yet
                </div>
            `;
            return;
        }

        container.innerHTML = this.alerts.map(alert => `
            <div class="list-group-item d-flex align-items-center gap-3 py-3">
                <div class="flex-shrink-0">
                    <span class="badge ${this.getPriorityClass(alert.priority)}">
                        ${alert.priority}
                    </span>
                </div>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${alert.title}</div>
                    <div class="small text-muted">
                        ${alert.type} • ${new Date(alert.created_at).toLocaleString()} • ${alert.recipients_count || 0} recipients
                    </div>
                </div>
                <div>
                    <span class="badge ${alert.status === 'sent' ? 'bg-success' : 'bg-secondary'}">
                        ${alert.status}
                    </span>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // BIND EVENTS
    // ============================================
    bindEvents() {
        document.getElementById('alertForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendAlert();
        });
    }

    // ============================================
    // SEND ALERT
    // ============================================
    async sendAlert() {
        const title = document.getElementById('alertTitle').value.trim();
        const message = document.getElementById('alertMessage').value.trim();
        const type = document.getElementById('alertType').value;
        const priority = document.getElementById('alertPriority').value;
        const channels = [];

        if (document.getElementById('channelApp').checked) channels.push('app');
        if (document.getElementById('channelSMS').checked) channels.push('sms');
        if (document.getElementById('channelEmail').checked) channels.push('email');

        if (!title || !message) {
            showNotification('Error', 'Please fill in all required fields', 'error');
            return;
        }

        if (channels.length === 0) {
            showNotification('Error', 'Please select at least one channel', 'error');
            return;
        }

        const btn = document.querySelector('#alertForm button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';

        try {
            const profile = window.Auth.getCurrentUserProfile();
            
            await window.NotificationService.sendAlertBroadcast(title, message, {
                type,
                priority,
                channels,
                sentBy: profile?.id || 'system'
            });

            showNotification(
                '✅ Alert Sent!',
                `Alert "${title}" has been broadcasted to ${channels.join(', ')}`,
                'success'
            );

            // Reset form
            document.getElementById('alertForm').reset();
            document.getElementById('channelApp').checked = true;

            // Reload history
            await this.loadData();

        } catch (error) {
            console.error('Error sending alert:', error);
            showNotification('Failed to send alert', error.message || 'Please try again', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-broadcast me-2"></i>Send Alert';
        }
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
}

// Make global
window.AlertBroadcaster = new AlertBroadcaster();