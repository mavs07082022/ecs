// js/services/analyticsService.js

class AnalyticsService {
    constructor() {
        this.supabase = window.supabase;
        this.charts = {};
    }

    // ============================================
    // GET ANALYTICS DATA
    // ============================================
    async getAnalyticsData() {
        try {
            const emergencies = await window.EmergencyService.getEmergencyReports();
            
            const total = emergencies.length;
            const active = emergencies.filter(e => !['resolved', 'closed', 'fake'].includes(e.status)).length;
            const resolved = emergencies.filter(e => e.status === 'resolved').length;
            
            // By type
            const byType = {};
            emergencies.forEach(e => {
                byType[e.type] = (byType[e.type] || 0) + 1;
            });

            // By priority
            const byPriority = {};
            emergencies.forEach(e => {
                byPriority[e.priority] = (byPriority[e.priority] || 0) + 1;
            });

            // By day (last 7 days)
            const last7Days = [];
            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                
                const count = emergencies.filter(e => {
                    const eDate = new Date(e.created_at);
                    return eDate.toLocaleDateString() === date.toLocaleDateString();
                }).length;
                
                last7Days.push({ date: dateStr, count });
            }

            // Response time (average)
            let totalResponseTime = 0;
            let responseCount = 0;
            emergencies.forEach(e => {
                if (e.acknowledged_at && e.created_at) {
                    const time = (new Date(e.acknowledged_at) - new Date(e.created_at)) / 60000; // minutes
                    if (time > 0) {
                        totalResponseTime += time;
                        responseCount++;
                    }
                }
            });
            const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;

            return {
                total,
                active,
                resolved,
                byType,
                byPriority,
                last7Days,
                avgResponseTime: Math.round(avgResponseTime * 10) / 10,
                resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0
            };

        } catch (error) {
            console.error('Error getting analytics:', error);
            return null;
        }
    }

    // ============================================
    // RENDER CHARTS
    // ============================================
    renderCharts(data, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="row g-4">
                <div class="col-lg-6">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-chart-pie me-2"></i>Emergency Types</h6>
                        </div>
                        <div class="card-body">
                            <canvas id="typeChart" height="200"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-chart-bar me-2"></i>Last 7 Days</h6>
                        </div>
                        <div class="card-body">
                            <canvas id="trendChart" height="200"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-circle-exclamation me-2"></i>By Priority</h6>
                        </div>
                        <div class="card-body">
                            <canvas id="priorityChart" height="200"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="card-modern">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="fas fa-clock me-2"></i>Response Time</h6>
                        </div>
                        <div class="card-body">
                            <div class="text-center py-4">
                                <div class="display-4 fw-bold text-primary">${data.avgResponseTime}m</div>
                                <p class="text-muted">Average Response Time</p>
                                <div class="progress" style="height: 8px;">
                                    <div class="progress-bar bg-success" style="width: ${Math.min((data.avgResponseTime / 10) * 100, 100)}%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Render charts after DOM update
        setTimeout(() => {
            this._renderTypeChart(data.byType);
            this._renderTrendChart(data.last7Days);
            this._renderPriorityChart(data.byPriority);
        }, 100);
    }

    // ============================================
    // TYPE CHART
    // ============================================
    _renderTypeChart(byType) {
        const ctx = document.getElementById('typeChart');
        if (!ctx) return;

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
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    // ============================================
    // TREND CHART
    // ============================================
    _renderTrendChart(last7Days) {
        const ctx = document.getElementById('trendChart');
        if (!ctx) return;

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: last7Days.map(d => d.date),
                datasets: [{
                    label: 'Emergencies',
                    data: last7Days.map(d => d.count),
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    }

    // ============================================
    // PRIORITY CHART
    // ============================================
    _renderPriorityChart(byPriority) {
        const ctx = document.getElementById('priorityChart');
        if (!ctx) return;

        const labels = Object.keys(byPriority).map(p => p.charAt(0).toUpperCase() + p.slice(1));
        const values = Object.values(byPriority);
        const colors = {
            critical: '#dc2626',
            high: '#ea580c',
            medium: '#eab308',
            low: '#2563eb'
        };

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: labels.map(l => colors[l.toLowerCase()] || '#64748b'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    }
}

// Make global
window.AnalyticsService = new AnalyticsService();