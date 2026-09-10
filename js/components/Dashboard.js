// js/components/Dashboard.js

class Dashboard {
    constructor() {
        this.container = document.getElementById('dashboardContent');
        this.emergencies = [];
        this.stats = null;
        this.subscription = null;
        this.chart = null;
    }

    // ============================================
    // RENDER
    // ============================================
    async render() {
        if (!this.container) return;

        // Show loading
        this.container.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-danger" role="status"></div>
                <p class="mt-3 text-muted">Loading dashboard...</p>
            </div>
        `;

        try {
            // Load data
            await this.loadData();

            // Render dashboard
            this.container.innerHTML = this.getHTML();

            // Setup real-time subscription
            this.setupRealtime();

            // Render charts
            this.renderCharts();

            // Start auto-refresh
            this.startAutoRefresh();

        } catch (error) {
            console.error('Error rendering dashboard:', error);
            this.container.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Failed to load dashboard. Please refresh the page.
                </div>
            `;
        }
    }

    // ============================================
    // LOAD DATA
    // ============================================
    async loadData() {
        this.emergencies = await window.EmergencyService.getEmergencyReports();
        this.stats = await window.EmergencyService.getStatistics();
    }

    // ============================================
    // GET HTML
    // ============================================
    getHTML() {
        const stats = this.stats || { total: 0, active: 0, critical: 0, resolved: 0 };
        const emergencies = this.emergencies || [];
        const recent = emergencies.slice(0, 5);

        return `
            <!-- Stats -->
            <div class="row g-4 mb-4">
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number">${stats.total}</div>
                                <div class="stat-label">Total Emergencies</div>
                            </div>
                            <div class="stat-icon bg-emergency-red-light text-emergency-red">
                                <i class="fas fa-flag"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left-color: var(--emergency-orange);">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number">${stats.active}</div>
                                <div class="stat-label">Active Emergencies</div>
                            </div>
                            <div class="stat-icon bg-warning bg-opacity-10 text-warning">
                                <i class="fas fa-clock"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left-color: var(--emergency-red);">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number">${stats.critical}</div>
                                <div class="stat-label">Critical Alerts</div>
                            </div>
                            <div class="stat-icon bg-danger bg-opacity-10 text-danger">
                                <i class="fas fa-triangle-exclamation"></i>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card" style="border-left-color: var(--emergency-green);">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <div class="stat-number">${stats.resolved}</div>
                                <div class="stat-label">Resolved</div>
                            </div>
                            <div class="stat-icon bg-success bg-opacity-10 text-success">
                                <i class="fas fa-check-circle"></i>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Charts -->
            <div class="row g-4 mb-4">
                <div class="col-lg-8">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-chart-line me-2"></i>Emergency Trends</h6>
                        </div>
                        <div class="card-body">
                            <canvas id="dashboardTrendChart" height="200"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-chart-pie me-2"></i>By Type</h6>
                        </div>
                        <div class="card-body">
                            <canvas id="dashboardTypeChart" height="200"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Recent Emergencies -->
            <div class="card-modern">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h6 class="mb-0"><i class="fas fa-list me-2"></i>Recent Emergencies</h6>
                    <span class="badge bg-primary rounded-pill">${emergencies.length} total</span>
                </div>
                <div class="card-body p-0">
                    ${recent.length === 0 ? `
                        <div class="text-center py-4 text-muted">
                            <i class="fas fa-check-circle fa-2x mb-2 d-block text-success"></i>
                            No emergencies reported yet
                        </div>
                    ` : `
                        <div class="list-group list-group-flush">
                            ${recent.map(emergency => `
                                <div class="list-group-item d-flex align-items-center gap-3 py-3 hover-bg-light">
                                    <div class="flex-shrink-0">
                                        <span class="badge ${this.getPriorityClass(emergency.priority)}">
                                            ${emergency.priority}
                                        </span>
                                    </div>
                                    <div class="flex-grow-1">
                                        <div class="fw-semibold">${emergency.title}</div>
                                        <div class="small text-muted">
                                            ${emergency.type} • ${this.getStatusLabel(emergency.status)}
                                            • ${new Date(emergency.created_at).toLocaleString()}
                                        </div>
                                    </div>
                                    <div>
                                        <span class="badge ${this.getStatusClass(emergency.status)}">
                                            ${this.getStatusLabel(emergency.status)}
                                        </span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
                <div class="card-footer bg-transparent">
                    <a href="#" onclick="navigateTo('map')" class="text-decoration-none">
                        View all on map <i class="fas fa-arrow-right ms-1"></i>
                    </a>
                </div>
            </div>
        `;
    }

    // ============================================
    // PRIORITY CLASS
    // ============================================
    getPriorityClass(priority) {
        const classes = {
            critical: 'bg-danger',
            high: 'bg-warning text-dark',
            medium: 'bg-info text-dark',
            low: 'bg-secondary'
        };
        return classes[priority] || 'bg-secondary';
    }

    // ============================================
    // STATUS CLASS
    // ============================================
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

    // ============================================
    // STATUS LABEL
    // ============================================
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
    // RENDER CHARTS
    // ============================================
    renderCharts() {
        setTimeout(() => {
            this.renderTrendChart();
            this.renderTypeChart();
        }, 100);
    }

    // ============================================
    // TREND CHART
    // ============================================
    renderTrendChart() {
        const ctx = document.getElementById('dashboardTrendChart');
        if (!ctx) return;

        // Get last 7 days
        const days = [];
        const counts = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            days.push(dateStr);
            
            const count = this.emergencies.filter(e => {
                const eDate = new Date(e.created_at);
                return eDate.toLocaleDateString() === date.toLocaleDateString();
            }).length;
            counts.push(count);
        }

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: days,
                datasets: [{
                    label: 'Emergencies',
                    data: counts,
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    // ============================================
    // TYPE CHART
    // ============================================
    renderTypeChart() {
        const ctx = document.getElementById('dashboardTypeChart');
        if (!ctx) return;

        const byType = {};
        this.emergencies.forEach(e => {
            byType[e.type] = (byType[e.type] || 0) + 1;
        });

        const labels = Object.keys(byType).map(t => t.charAt(0).toUpperCase() + t.slice(1));
        const values = Object.values(byType);
        const colors = ['#dc2626', '#2563eb', '#ea580c', '#16a34a', '#7c3aed', '#eab308', '#64748b'];

        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    // ============================================
    // REALTIME
    // ============================================
    setupRealtime() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }

        this.subscription = window.EmergencyService.subscribeToEmergencies((payload) => {
            console.log('🔄 Real-time update:', payload.eventType, payload.new);
            this.loadData().then(() => {
                this.refreshUI();
            });
        });
    }

    // ============================================
    // REFRESH UI
    // ============================================
    refreshUI() {
        // Update stats
        const stats = this.stats;
        document.querySelectorAll('.stat-number').forEach((el, index) => {
            const values = [stats.total, stats.active, stats.critical, stats.resolved];
            if (el && index < values.length) {
                el.textContent = values[index];
            }
        });

        // Re-render charts
        this.renderCharts();

        // Update recent list
        const recent = this.emergencies.slice(0, 5);
        // ... update list
    }

    // ============================================
    // AUTO REFRESH
    // ============================================
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            this.loadData().then(() => {
                this.refreshUI();
            });
        }, 30000); // Refresh every 30 seconds
    }

    // ============================================
    // DESTROY
    // ============================================
    destroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Create instance
window.Dashboard = new Dashboard();