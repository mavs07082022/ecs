// js/services/hotlineService.js

class HotlineService {
    constructor() {
        this.supabase = window.supabase;
        this.table = 'hotline_calls';
        this.callLog = [];
        this.isListening = false;
    }

    // ============================================
    // LOG CALL
    // ============================================
    async logCall(callData) {
        try {
            const data = {
                caller_number: callData.number,
                caller_name: callData.name || 'Unknown',
                description: callData.description || '',
                emergency_type: callData.emergencyType || null,
                priority: callData.priority || 'medium',
                status: callData.status || 'pending',
                duration: callData.duration || 0,
                notes: callData.notes || '',
                assigned_to: callData.assignedTo || null,
                created_at: new Date(),
                updated_at: new Date()
            };

            // If emergency_type is provided, try to create an emergency report
            if (callData.emergencyType && callData.description) {
                const { data: result, error } = await this.supabase
                    .from(this.table)
                    .insert([data])
                    .select()
                    .single();

                if (error) throw error;

                // Create emergency from hotline call
                if (window.EmergencyService) {
                    const emergencyId = await window.EmergencyService.createEmergencyReport({
                        title: `Hotline: ${callData.emergencyType}`,
                        description: callData.description,
                        phone: callData.number,
                        latitude: callData.latitude || 14.5995,
                        longitude: callData.longitude || 120.9842,
                        address: callData.address || '',
                        source: 'hotline'
                    }, callData.assignedTo || 'system', callData.name || 'Hotline Caller');

                    // Link emergency to call
                    if (emergencyId) {
                        await this.supabase
                            .from(this.table)
                            .update({ emergency_id: emergencyId })
                            .eq('id', result.id);
                    }
                }

                return result.id;
            }

            // Just log the call
            const { data: result, error } = await this.supabase
                .from(this.table)
                .insert([data])
                .select()
                .single();

            if (error) throw error;

            // Add to local log
            this.callLog.unshift({
                id: result.id,
                ...data,
                created_at: new Date()
            });

            return result.id;

        } catch (error) {
            console.error('Error logging hotline call:', error);
            throw error;
        }
    }

    // ============================================
    // GET CALLS
    // ============================================
    async getCalls(filters = {}) {
        try {
            let query = this.supabase
                .from(this.table)
                .select('*, profiles(name)')
                .order('created_at', { ascending: false });

            if (filters.status) query = query.eq('status', filters.status);
            if (filters.priority) query = query.eq('priority', filters.priority);
            if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);

            const { data, error } = await query;
            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Error fetching hotline calls:', error);
            return [];
        }
    }

    // ============================================
    // UPDATE CALL STATUS
    // ============================================
    async updateCallStatus(callId, status, notes = '') {
        try {
            const updateData = {
                status,
                updated_at: new Date()
            };

            if (notes) {
                const call = await this.supabase
                    .from(this.table)
                    .select('notes')
                    .eq('id', callId)
                    .single();

                const currentNotes = call.data?.notes || '';
                updateData.notes = currentNotes + '\n' + new Date().toLocaleString() + ': ' + notes;
            }

            const { error } = await this.supabase
                .from(this.table)
                .update(updateData)
                .eq('id', callId);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error updating call status:', error);
            return false;
        }
    }

    // ============================================
    // ASSIGN CALL
    // ============================================
    async assignCall(callId, userId) {
        try {
            const { error } = await this.supabase
                .from(this.table)
                .update({ assigned_to: userId, updated_at: new Date() })
                .eq('id', callId);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error assigning call:', error);
            return false;
        }
    }

    // ============================================
    // SIMULATE INCOMING CALL
    // ============================================
    simulateIncomingCall(number, name, description, emergencyType) {
        console.log(`📞 Incoming call from ${number} (${name})`);
        
        // Determine priority
        let priority = 'medium';
        if (['critical', 'high'].includes(emergencyType) || 
            description.toLowerCase().includes('fire') || 
            description.toLowerCase().includes('heart') ||
            description.toLowerCase().includes('gun')) {
            priority = 'critical';
        }

        // Log the call
        this.logCall({
            number,
            name,
            description,
            emergencyType,
            priority,
            status: 'pending'
        });

        // Show notification
        if (window.NotificationService) {
            window.NotificationService._showToast(
                '📞 Incoming Hotline Call',
                `${name} (${number}) - ${description.substring(0, 50)}...`,
                'emergency'
            );
        }

        // Play sound
        this._playCallSound();
    }

    // ============================================
    // PLAY CALL SOUND
    // ============================================
    _playCallSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            
            // Ring pattern
            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
            
            setTimeout(() => {
                oscillator.stop();
                // Second ring
                const osc2 = audioContext.createOscillator();
                const gain2 = audioContext.createGain();
                osc2.connect(gain2);
                gain2.connect(audioContext.destination);
                osc2.frequency.value = 800;
                osc2.type = 'sine';
                gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
                osc2.start();
                gain2.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
                setTimeout(() => osc2.stop(), 500);
            }, 600);
            
        } catch (error) {
            console.warn('Could not play call sound:', error);
        }
    }

    // ============================================
    // GET STATISTICS
    // ============================================
    async getStatistics() {
        try {
            const calls = await this.getCalls();
            
            const total = calls.length;
            const pending = calls.filter(c => c.status === 'pending').length;
            const resolved = calls.filter(c => c.status === 'resolved').length;
            
            const byPriority = {};
            calls.forEach(c => {
                byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
            });

            return {
                total,
                pending,
                resolved,
                byPriority
            };

        } catch (error) {
            console.error('Error getting hotline stats:', error);
            return null;
        }
    }
}

// Make global
window.HotlineService = new HotlineService();

// Simulate a call every 30 seconds for demo (remove in production)
// setInterval(() => {
//     const names = ['Juan Dela Cruz', 'Maria Santos', 'Jose Reyes', 'Ana Garcia'];
//     const number = '09' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
//     const name = names[Math.floor(Math.random() * names.length)];
//     const emergencies = ['Fire', 'Medical', 'Accident', 'Flood', 'Security'];
//     const emergencyType = emergencies[Math.floor(Math.random() * emergencies.length)];
//     const description = `${emergencyType} emergency reported at Barangay ${Math.floor(Math.random() * 10) + 1}`;
    
//     window.HotlineService.simulateIncomingCall(number, name, description, emergencyType.toLowerCase());
// }, 30000);