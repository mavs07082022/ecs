// js/components/EmergencyMap.js

class EmergencyMap {
    constructor() {
        this.container = document.getElementById('pageContent');
        this.map = null;
        this.markers = [];
        this.emergencies = [];
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
                    <h4><i class="fas fa-map text-danger me-2"></i>Emergency Map</h4>
                    <p class="text-muted small">Real-time emergency locations</p>
                </div>
                <div>
                    <button class="btn btn-outline-secondary btn-sm" onclick="window.EmergencyMap.refresh()">
                        <i class="fas fa-refresh me-1"></i>Refresh
                    </button>
                </div>
            </div>
            <div class="map-container" id="emergencyMapContainer"></div>
            <div class="row mt-4" id="emergencyList"></div>
        `;

        await this.loadData();
        this.initMap();
        this.setupRealtime();
    }

    // ============================================
    // LOAD DATA
    // ============================================
    async loadData() {
        this.emergencies = await window.EmergencyService.getEmergencyReports({
            status: ['reported', 'acknowledged', 'responding']
        });
    }

    // ============================================
    // INIT MAP
    // ============================================
    initMap() {
        const container = document.getElementById('emergencyMapContainer');
        if (!container) return;

        // Default center (Philippines)
        const center = [14.5995, 120.9842];

        this.map = L.map(container).setView(center, 11);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Add markers
        this.addMarkers();

        // Fit bounds if there are emergencies
        if (this.emergencies.length > 0) {
            const bounds = this.emergencies.map(e => [e.location.latitude, e.location.longitude]);
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }

        // Handle resize
        setTimeout(() => {
            if (this.map) this.map.invalidateSize();
        }, 500);
    }

    // ============================================
    // ADD MARKERS
    // ============================================
    addMarkers() {
        // Clear existing markers
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        const colors = {
            fire: '#dc2626',
            medical: '#dc2626',
            armed_conflict: '#ea580c',
            flood: '#2563eb',
            accident: '#ea580c',
            natural_disaster: '#7c3aed',
            other: '#64748b'
        };

        this.emergencies.forEach(emergency => {
            const color = colors[emergency.type] || '#64748b';
            
            // Create custom marker
            const marker = L.marker([emergency.location.latitude, emergency.location.longitude], {
                icon: L.divIcon({
                    className: 'custom-marker',
                    html: `<i class="fas fa-triangle-exclamation"></i>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 32]
                })
            }).addTo(this.map);

            // Popup
            marker.bindPopup(`
                <div style="min-width: 200px;">
                    <h6 class="fw-bold mb-1">${emergency.title}</h6>
                    <p class="small text-muted mb-1">${emergency.description.substring(0, 100)}...</p>
                    <div class="d-flex gap-2 mb-1">
                        <span class="badge ${this.getPriorityClass(emergency.priority)}">${emergency.priority}</span>
                        <span class="badge ${this.getStatusClass(emergency.status)}">${this.getStatusLabel(emergency.status)}</span>
                    </div>
                    <div class="small text-muted">
                        ${emergency.type} • ${new Date(emergency.created_at).toLocaleString()}
                    </div>
                    <button class="btn btn-sm btn-outline-danger mt-2" 
                            onclick="window.EmergencyMap.viewEmergency('${emergency.id}')">
                        View Details
                    </button>
                </div>
            `);

            this.markers.push(marker);
        });
    }

    // ============================================
    // VIEW EMERGENCY
    // ============================================
    viewEmergency(id) {
        navigateTo('dashboard');
        // TODO: Open emergency details
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
    // REFRESH
    // ============================================
    async refresh() {
        await this.loadData();
        this.addMarkers();
        showNotification('Map refreshed', `Showing ${this.emergencies.length} emergencies`, 'info');
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
                this.loadData().then(() => {
                    this.addMarkers();
                });
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
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }
}

// Make global
window.EmergencyMap = new EmergencyMap();