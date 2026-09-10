// js/components/ReportForm.js

class ReportForm {
    constructor() {
        this.container = document.getElementById('pageContent');
        this.isSubmitting = false;
        this.location = null;
    }

    // ============================================
    // RENDER
    // ============================================
    async render() {
        if (!this.container) return;

        // Check if logged in
        if (!window.Auth.isLoggedIn()) {
            this.container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-lock fa-3x text-muted mb-3"></i>
                    <h4>Please Login to Report</h4>
                    <p class="text-muted">You need to be logged in to submit an emergency report.</p>
                    <button class="btn btn-danger" onclick="window.Auth.showAuthModal('login')">
                        <i class="fas fa-sign-in-alt me-2"></i>Login
                    </button>
                </div>
            `;
            return;
        }

        this.container.innerHTML = this.getHTML();
        this.bindEvents();
        this.getLocation();
    }

    // ============================================
    // GET HTML
    // ============================================
    getHTML() {
        return `
            <div class="row justify-content-center">
                <div class="col-lg-8">
                    <div class="card-modern">
                        <div class="card-header">
                            <h5 class="mb-0">
                                <i class="fas fa-flag text-danger me-2"></i>
                                Report an Emergency
                            </h5>
                            <small class="text-muted">Your report will be analyzed by AI for faster response</small>
                        </div>
                        <div class="card-body">
                            <form id="reportForm">
                                <!-- Emergency Type -->
                                <div class="mb-4">
                                    <label class="form-label fw-semibold">Emergency Type <span class="text-danger">*</span></label>
                                    <div class="d-flex flex-wrap gap-2">
                                        ${[
                                            { value: 'fire', label: '🔥 Fire', icon: 'fa-fire' },
                                            { value: 'medical', label: '🏥 Medical', icon: 'fa-heart' },
                                            { value: 'armed_conflict', label: '⚔️ Security', icon: 'fa-shield' },
                                            { value: 'flood', label: '🌊 Flood', icon: 'fa-water' },
                                            { value: 'accident', label: '💥 Accident', icon: 'fa-car-crash' },
                                            { value: 'natural_disaster', label: '🌪️ Disaster', icon: 'fa-cloud' },
                                            { value: 'other', label: '📋 Other', icon: 'fa-ellipsis' }
                                        ].map(type => `
                                            <button type="button" class="btn btn-outline-secondary type-btn" data-type="${type.value}">
                                                ${type.label}
                                            </button>
                                        `).join('')}
                                    </div>
                                    <input type="hidden" id="emergencyType" value="other">
                                </div>

                                <!-- Title -->
                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Title <span class="text-danger">*</span></label>
                                    <input type="text" class="form-control form-control-modern" id="reportTitle" 
                                           placeholder="Brief description of the emergency" required>
                                </div>

                                <!-- Description -->
                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Description <span class="text-danger">*</span></label>
                                    <textarea class="form-control form-control-modern" id="reportDescription" 
                                              rows="4" placeholder="Describe what happened in detail..." required></textarea>
                                </div>

                                <!-- AI Classification -->
                                <div class="mb-3">
                                    <button type="button" class="btn btn-purple" id="aiClassifyBtn">
                                        <i class="fas fa-robot me-2"></i>Classify with AI
                                    </button>
                                    <div id="aiResult" class="mt-2 d-none">
                                        <div class="p-3 bg-purple-light rounded-3">
                                            <div class="d-flex align-items-center gap-3">
                                                <span class="badge bg-purple" id="aiType">-</span>
                                                <span class="badge" id="aiPriority">-</span>
                                                <span class="text-muted small">Confidence: <span id="aiConfidence">-</span>%</span>
                                            </div>
                                            <div class="mt-2 small text-muted">
                                                Resources: <span id="aiResources">-</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Location -->
                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Location <span class="text-danger">*</span></label>
                                    <div class="input-group">
                                        <input type="text" class="form-control form-control-modern" id="reportAddress" 
                                               placeholder="Enter address or use current location">
                                        <button class="btn btn-primary-modern" type="button" id="getLocationBtn">
                                            <i class="fas fa-location-dot"></i>
                                        </button>
                                    </div>
                                    <div id="locationStatus" class="small text-muted mt-1">
                                        <i class="fas fa-spinner fa-spin"></i> Getting location...
                                    </div>
                                </div>

                                <!-- Phone -->
                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Contact Number <span class="text-danger">*</span></label>
                                    <input type="tel" class="form-control form-control-modern" id="reportPhone" 
                                           placeholder="09123456789 or +639123456789" required>
                                    <small class="text-muted">📞 Enter 11-digit Philippine number</small>
                                </div>

                                <!-- Submit -->
                                <button type="submit" class="btn btn-emergency btn-lg w-100" id="submitBtn">
                                    <i class="fas fa-paper-plane me-2"></i>
                                    Submit Emergency Report
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // BIND EVENTS
    // ============================================
    bindEvents() {
        // Type buttons
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('btn-danger', 'text-white'));
                btn.classList.add('btn-danger', 'text-white');
                document.getElementById('emergencyType').value = btn.dataset.type;
            });
        });

        // Get location
        document.getElementById('getLocationBtn').addEventListener('click', () => this.getLocation());

        // AI Classify
        document.getElementById('aiClassifyBtn').addEventListener('click', () => this.classifyWithAI());

        // Form submit
        document.getElementById('reportForm').addEventListener('submit', (e) => this.handleSubmit(e));
    }

    // ============================================
    // GET LOCATION
    // ============================================
    getLocation() {
        const status = document.getElementById('locationStatus');
        
        if (!navigator.geolocation) {
            status.innerHTML = '<i class="fas fa-exclamation-circle text-warning"></i> Geolocation not supported';
            return;
        }

        status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                status.innerHTML = `
                    <i class="fas fa-check-circle text-success"></i> 
                    Location captured: ${this.location.latitude.toFixed(6)}, ${this.location.longitude.toFixed(6)}
                `;
                
                // Reverse geocode (optional)
                this.reverseGeocode(this.location.latitude, this.location.longitude);
            },
            (error) => {
                console.error('Geolocation error:', error);
                status.innerHTML = `
                    <i class="fas fa-exclamation-circle text-warning"></i> 
                    Could not get location. Please enter address manually.
                `;
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // ============================================
    // REVERSE GEOCODE
    // ============================================
    async reverseGeocode(lat, lng) {
        try {
            // Using OpenStreetMap Nominatim (free, no API key needed)
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`
            );
            const data = await response.json();
            
            if (data.display_name) {
                document.getElementById('reportAddress').value = data.display_name;
            }
        } catch (error) {
            console.warn('Reverse geocode error:', error);
        }
    }

    // ============================================
    // CLASSIFY WITH AI
    // ============================================
    async classifyWithAI() {
        const description = document.getElementById('reportDescription').value;
        if (!description.trim()) {
            showNotification('Please enter a description first', 'AI needs description to classify', 'warning');
            return;
        }

        const btn = document.getElementById('aiClassifyBtn');
        const resultDiv = document.getElementById('aiResult');
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Analyzing...';

        try {
            const classification = await window.OpenAIService.classifyEmergency(description);
            
            // Show result
            resultDiv.classList.remove('d-none');
            document.getElementById('aiType').textContent = classification.type;
            document.getElementById('aiType').className = `badge bg-${this.getTypeColor(classification.type)}`;
            
            document.getElementById('aiPriority').textContent = classification.priority.toUpperCase();
            document.getElementById('aiPriority').className = `badge ${this.getPriorityClass(classification.priority)}`;
            
            document.getElementById('aiConfidence').textContent = Math.round(classification.confidence * 100);
            document.getElementById('aiResources').textContent = classification.suggestedResources.join(', ') || 'None';

            // Auto-fill title if empty
            if (!document.getElementById('reportTitle').value && classification.title) {
                document.getElementById('reportTitle').value = classification.title;
            }

            // Auto-select type
            const typeBtn = document.querySelector(`.type-btn[data-type="${classification.type}"]`);
            if (typeBtn) {
                typeBtn.click();
            }

            showNotification('AI Classification Complete', `Type: ${classification.type}, Priority: ${classification.priority}`, 'success');

        } catch (error) {
            console.error('Classification error:', error);
            showNotification('Classification failed', 'Please try again or classify manually', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-robot me-2"></i>Classify with AI';
        }
    }

    // ============================================
    // HELPERS
    // ============================================
    getTypeColor(type) {
        const colors = {
            fire: 'danger',
            medical: 'danger',
            armed_conflict: 'warning',
            flood: 'primary',
            accident: 'warning',
            natural_disaster: 'info',
            other: 'secondary'
        };
        return colors[type] || 'secondary';
    }

    getPriorityClass(priority) {
        const classes = {
            critical: 'bg-danger text-white',
            high: 'bg-warning text-dark',
            medium: 'bg-info text-dark',
            low: 'bg-secondary text-white'
        };
        return classes[priority] || 'bg-secondary text-white';
    }

    // ============================================
    // HANDLE SUBMIT
    // ============================================
    async handleSubmit(e) {
        e.preventDefault();
        
        if (this.isSubmitting) return;

        const user = window.Auth.getCurrentUser();
        const profile = window.Auth.getCurrentUserProfile();

        // Validate
        const title = document.getElementById('reportTitle').value.trim();
        const description = document.getElementById('reportDescription').value.trim();
        const address = document.getElementById('reportAddress').value.trim();
        const phone = document.getElementById('reportPhone').value.trim();
        const type = document.getElementById('emergencyType').value;

        if (!title) {
            showNotification('Error', 'Please enter a title', 'error');
            return;
        }
        if (!description || description.length < 10) {
            showNotification('Error', 'Please provide a detailed description (at least 10 characters)', 'error');
            return;
        }
        if (!address && !this.location) {
            showNotification('Error', 'Please provide a location or use current location', 'error');
            return;
        }
        if (!phone) {
            showNotification('Error', 'Please enter your contact number', 'error');
            return;
        }

        // Validate phone
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        const phoneRegex = /^(09|\+63)[0-9]{9}$/;
        if (!phoneRegex.test(cleanPhone)) {
            showNotification('Error', 'Please enter a valid Philippine phone number (e.g., 09123456789)', 'error');
            return;
        }

        this.isSubmitting = true;
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Submitting...';

        try {
            const emergencyId = await window.EmergencyService.createEmergencyReport({
                title,
                description,
                address,
                phone: cleanPhone,
                latitude: this.location?.latitude || 14.5995,
                longitude: this.location?.longitude || 120.9842,
                source: 'app',
                type: type
            }, user.id, profile?.name || user.email);

            showNotification(
                '✅ Emergency Reported!',
                `Your report has been submitted. ID: ${emergencyId.substring(0, 8)}`,
                'success'
            );

            // Reset form
            document.getElementById('reportForm').reset();
            document.getElementById('aiResult').classList.add('d-none');
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('btn-danger', 'text-white'));

            // Navigate to dashboard
            setTimeout(() => navigateTo('dashboard'), 1500);

        } catch (error) {
            console.error('Submit error:', error);
            showNotification('Failed to submit report', error.message || 'Please try again', 'error');
        } finally {
            this.isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Submit Emergency Report';
        }
    }
}

// Make global
window.ReportForm = new ReportForm();