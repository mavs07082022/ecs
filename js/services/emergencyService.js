// js/services/emergencyService.js

class EmergencyService {
    constructor() {
        this.supabase = window.supabase;
        this.table = 'emergencies';
        this.notesTable = 'emergency_notes';
        this.subscriptions = [];
    }

    // ============================================
    // CREATE EMERGENCY REPORT
    // ============================================
    async createEmergencyReport(data, userId, userName) {
        try {
            console.log('📝 Creating emergency report...');
            
            // Get AI classification
            let classification = { type: 'other', priority: 'medium', title: 'Emergency Report' };
            if (window.OpenAIService) {
                classification = await window.OpenAIService.classifyEmergency(data.description);
            }
            
            const finalType = classification.type || 'other';
            const finalPriority = classification.priority || 'medium';
            const finalTitle = data.title || classification.title || 'Emergency Report';

            const reportData = {
                type: finalType,
                priority: finalPriority,
                status: 'reported',
                title: finalTitle,
                description: data.description,
                location: {
                    latitude: data.latitude || 14.5995,
                    longitude: data.longitude || 120.9842,
                    address: data.address || ''
                },
                reporter_id: userId,
                reporter_name: userName || 'Anonymous',
                reporter_phone: data.phone || '',
                images: data.images || [],
                source: data.source || 'app',
                ai_classification: classification,
                is_read: false,
                created_at: new Date(),
                updated_at: new Date()
            };

            // Insert
            const { data: result, error } = await this.supabase
                .from(this.table)
                .insert([reportData])
                .select()
                .single();

            if (error) throw error;

            // Add AI note
            if (result.id) {
                await this.addNote(
                    result.id,
                    userId || 'system',
                    'AI Assistant',
                    `🤖 AI Classification: ${finalType} (${finalPriority}), Confidence: ${Math.round((classification.confidence || 0.5) * 100)}%, Resources: ${classification.suggestedResources?.join(', ') || 'None'}`,
                    'classified'
                );
                
                // Auto-acknowledge critical emergencies
                if (finalPriority === 'critical') {
                    await this.acknowledgeEmergency(result.id, 'system', 'System', '🚨 Critical emergency auto-acknowledged');
                }
                
                // Send notification to responders
                await this.notifyResponders(result.id, finalTitle, finalPriority);
            }

            console.log('✅ Emergency created:', result.id);
            return result.id;

        } catch (error) {
            console.error('❌ Error creating emergency:', error);
            throw error;
        }
    }

    // ============================================
    // NOTIFY RESPONDERS
    // ============================================
    async notifyResponders(emergencyId, title, priority) {
        try {
            // Get all responder users
            const { data: responders, error } = await this.supabase
                .from('profiles')
                .select('id')
                .in('role', ['responder', 'dispatcher', 'admin']);

            if (error) throw error;

            const priorityEmoji = {
                critical: '🚨',
                high: '⚠️',
                medium: '📌',
                low: 'ℹ️'
            };

            // Send notifications to each responder
            for (const responder of responders) {
                await window.NotificationService.createNotification(
                    responder.id,
                    `${priorityEmoji[priority] || '📢'} New Emergency: ${title}`,
                    `A ${priority} priority emergency has been reported. Please check the dashboard.`,
                    'emergency',
                    { emergencyId, priority }
                );
            }

            console.log(`📨 Notified ${responders.length} responders`);
        } catch (error) {
            console.warn('⚠️ Error notifying responders:', error);
        }
    }

    // ============================================
    // GET EMERGENCIES
    // ============================================
    async getEmergencyReports(filters = {}) {
        try {
            let query = this.supabase
                .from(this.table)
                .select('*')
                .order('created_at', { ascending: false });

            if (filters.status) query = query.eq('status', filters.status);
            if (filters.priority) query = query.eq('priority', filters.priority);
            if (filters.type) query = query.eq('type', filters.type);
            if (filters.reporter_id) query = query.eq('reporter_id', filters.reporter_id);
            if (filters.source) query = query.eq('source', filters.source);

            const { data, error } = await query;
            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Error fetching emergencies:', error);
            return [];
        }
    }

    // ============================================
    // GET SINGLE EMERGENCY
    // ============================================
    async getEmergencyById(id) {
        try {
            const { data, error } = await this.supabase
                .from(this.table)
                .select('*, emergency_notes(*)')
                .eq('id', id)
                .single();

            if (error) throw error;
            return data;

        } catch (error) {
            console.error('Error fetching emergency:', error);
            return null;
        }
    }

    // ============================================
    // UPDATE STATUS
    // ============================================
    async updateEmergencyStatus(id, status, userId, userName, notes = '') {
        try {
            const updateData = {
                status,
                updated_at: new Date()
            };

            if (status === 'acknowledged') {
                updateData.acknowledged_by = userId;
                updateData.acknowledged_at = new Date();
            } else if (status === 'responding') {
                updateData.responded_by = userId;
                updateData.responded_at = new Date();
            } else if (status === 'resolved') {
                updateData.resolved_by = userId;
                updateData.resolved_at = new Date();
            } else if (status === 'verified') {
                updateData.verified_by = userId;
                updateData.verified_at = new Date();
                updateData.verified_status = 'verified';
            } else if (status === 'fake' || status === 'duplicate') {
                updateData.verified_by = userId;
                updateData.verified_at = new Date();
                updateData.verified_status = status;
            }

            const { error } = await this.supabase
                .from(this.table)
                .update(updateData)
                .eq('id', id);

            if (error) throw error;

            if (notes) {
                await this.addNote(id, userId, userName || 'System', notes, status);
            }

            // Notify reporter if status changed to resolved
            if (status === 'resolved') {
                const emergency = await this.getEmergencyById(id);
                if (emergency?.reporter_id) {
                    await window.NotificationService.createNotification(
                        emergency.reporter_id,
                        '✅ Emergency Resolved',
                        `Your emergency report "${emergency.title}" has been resolved. Thank you for your cooperation.`,
                        'update',
                        { emergencyId: id }
                    );
                }
            }

            return true;

        } catch (error) {
            console.error('Error updating status:', error);
            throw error;
        }
    }

    // ============================================
    // STATUS SHORTCUTS
    // ============================================
    async acknowledgeEmergency(id, userId, userName, notes = '') {
        return this.updateEmergencyStatus(id, 'acknowledged', userId, userName, notes);
    }

    async respondToEmergency(id, userId, userName, notes = '') {
        return this.updateEmergencyStatus(id, 'responding', userId, userName, notes);
    }

    async resolveEmergency(id, userId, userName, notes = '') {
        return this.updateEmergencyStatus(id, 'resolved', userId, userName, notes);
    }

    async verifyEmergency(id, userId, userName, notes = '') {
        return this.updateEmergencyStatus(id, 'verified', userId, userName, notes);
    }

    async markAsFake(id, userId, userName, notes = '') {
        return this.updateEmergencyStatus(id, 'fake', userId, userName, notes);
    }

    // ============================================
    // ADD NOTE
    // ============================================
    async addNote(emergencyId, userId, userName, text, action = 'note') {
        try {
            const noteData = {
                emergency_id: emergencyId,
                user_id: userId,
                user_name: userName || 'System',
                text,
                action,
                created_at: new Date()
            };

            const { error } = await this.supabase
                .from(this.notesTable)
                .insert([noteData]);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error adding note:', error);
            return false;
        }
    }

    // ============================================
    // GET NOTES
    // ============================================
    async getNotes(emergencyId) {
        try {
            const { data, error } = await this.supabase
                .from(this.notesTable)
                .select('*')
                .eq('emergency_id', emergencyId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Error fetching notes:', error);
            return [];
        }
    }

    // ============================================
    // REAL-TIME SUBSCRIPTION
    // ============================================
    subscribeToEmergencies(callback, filters = {}) {
        const channel = this.supabase
            .channel('emergencies-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'emergencies'
                },
                (payload) => {
                    callback(payload);
                }
            )
            .subscribe();

        this.subscriptions.push(channel);
        return channel;
    }

    subscribeToEmergency(id, callback) {
        const channel = this.supabase
            .channel(`emergency-${id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'emergencies',
                    filter: `id=eq.${id}`
                },
                (payload) => {
                    callback(payload);
                }
            )
            .subscribe();

        this.subscriptions.push(channel);
        return channel;
    }

    // ============================================
    // CLEANUP
    // ============================================
    unsubscribeAll() {
        this.subscriptions.forEach(channel => {
            channel.unsubscribe();
        });
        this.subscriptions = [];
    }

    // ============================================
    // STATISTICS
    // ============================================
    async getStatistics() {
        try {
            const emergencies = await this.getEmergencyReports();
            
            const total = emergencies.length;
            const active = emergencies.filter(e => !['resolved', 'closed', 'fake'].includes(e.status)).length;
            const critical = emergencies.filter(e => e.priority === 'critical' && !['resolved', 'closed'].includes(e.status)).length;
            const resolved = emergencies.filter(e => e.status === 'resolved').length;
            
            const byType = {};
            const byPriority = {};
            
            emergencies.forEach(e => {
                byType[e.type] = (byType[e.type] || 0) + 1;
                byPriority[e.priority] = (byPriority[e.priority] || 0) + 1;
            });

            return {
                total,
                active,
                critical,
                resolved,
                byType,
                byPriority,
                resolutionRate: total > 0 ? (resolved / total) * 100 : 0
            };

        } catch (error) {
            console.error('Error getting statistics:', error);
            return null;
        }
    }
}

// Make global
window.EmergencyService = new EmergencyService();