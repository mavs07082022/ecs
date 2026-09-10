// js/services/notificationService.js

class NotificationService {
    constructor() {
        this.supabase = window.supabase;
        this.table = 'notifications';
        this.alertsTable = 'alerts';
        this.alertRecipientsTable = 'alert_recipients';
        this.notificationContainer = document.getElementById('notificationContainer');
    }

    // ============================================
    // CREATE NOTIFICATION
    // ============================================
    async createNotification(userId, title, message, type = 'system', data = null) {
        try {
            if (!userId) {
                console.warn('No userId provided, skipping notification');
                return null;
            }

            const notificationData = {
                user_id: userId,
                title,
                message,
                type: type || 'system',
                priority: data?.priority || 'medium',
                read: false,
                data,
                created_at: new Date()
            };

            const { data: result, error } = await this.supabase
                .from(this.table)
                .insert([notificationData])
                .select()
                .single();

            if (error) throw error;

            // Show browser notification
            this._showBrowserNotification(title, message);
            
            // Show toast
            this._showToast(title, message, type);

            return result.id;

        } catch (error) {
            console.error('Error creating notification:', error);
            return null;
        }
    }

    // ============================================
    // GET USER NOTIFICATIONS
    // ============================================
    async getUserNotifications(userId, limit = 50) {
        try {
            const { data, error } = await this.supabase
                .from(this.table)
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
    }

    // ============================================
    // MARK AS READ
    // ============================================
    async markAsRead(notificationId) {
        try {
            const { error } = await this.supabase
                .from(this.table)
                .update({ read: true })
                .eq('id', notificationId);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error marking as read:', error);
            return false;
        }
    }

    // ============================================
    // MARK ALL AS READ
    // ============================================
    async markAllAsRead(userId) {
        try {
            const { error } = await this.supabase
                .from(this.table)
                .update({ read: true })
                .eq('user_id', userId)
                .eq('read', false);

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error marking all as read:', error);
            return false;
        }
    }

    // ============================================
    // GET UNREAD COUNT
    // ============================================
    async getUnreadCount(userId) {
        try {
            const { count, error } = await this.supabase
                .from(this.table)
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('read', false);

            if (error) throw error;
            return count || 0;

        } catch (error) {
            console.error('Error getting unread count:', error);
            return 0;
        }
    }

    // ============================================
    // SEND ALERT BROADCAST
    // ============================================
    async sendAlertBroadcast(title, message, options = {}) {
        try {
            const {
                type = 'general',
                priority = 'medium',
                targetArea = null,
                channels = ['app'],
                expiresAt = null,
                sentBy = null
            } = options;

            // Create alert
            const alertData = {
                title,
                message,
                type,
                priority,
                target_area: targetArea,
                channels,
                status: 'sent',
                sent_by: sentBy,
                sent_at: new Date(),
                expires_at: expiresAt,
                recipients_count: 0,
                created_at: new Date(),
                updated_at: new Date()
            };

            const { data: alert, error: alertError } = await this.supabase
                .from(this.alertsTable)
                .insert([alertData])
                .select()
                .single();

            if (alertError) throw alertError;

            // Get recipients
            const { data: recipients, error: recipientError } = await this.supabase
                .from('profiles')
                .select('id');

            if (recipientError) throw recipientError;

            // Send to each recipient
            for (const recipient of recipients) {
                // App notification
                if (channels.includes('app')) {
                    await this.createNotification(
                        recipient.id,
                        title,
                        message,
                        'alert',
                        { alertId: alert.id, priority }
                    );
                }

                // SMS (simulate)
                if (channels.includes('sms')) {
                    console.log(`📱 SMS to ${recipient.id}: ${message}`);
                }

                // Email (simulate)
                if (channels.includes('email')) {
                    console.log(`📧 Email to ${recipient.id}: ${message}`);
                }

                // Record recipient
                await this.supabase
                    .from(this.alertRecipientsTable)
                    .insert([{
                        alert_id: alert.id,
                        user_id: recipient.id,
                        channel: 'app',
                        status: 'sent',
                        sent_at: new Date()
                    }]);
            }

            // Update recipient count
            await this.supabase
                .from(this.alertsTable)
                .update({ recipients_count: recipients.length })
                .eq('id', alert.id);

            return alert.id;

        } catch (error) {
            console.error('Error sending alert broadcast:', error);
            throw error;
        }
    }

    // ============================================
    // GET ALERTS
    // ============================================
    async getAlerts(limit = 20) {
        try {
            const { data, error } = await this.supabase
                .from(this.alertsTable)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Error fetching alerts:', error);
            return [];
        }
    }

    // ============================================
    // TOAST NOTIFICATIONS
    // ============================================
    _showToast(title, message, type = 'system') {
        if (!this.notificationContainer) return;

        const colors = {
            emergency: 'border-danger bg-danger bg-opacity-10',
            alert: 'border-warning bg-warning bg-opacity-10',
            update: 'border-info bg-info bg-opacity-10',
            system: 'border-secondary bg-secondary bg-opacity-10'
        };

        const icons = {
            emergency: 'fa-triangle-exclamation text-danger',
            alert: 'fa-bell text-warning',
            update: 'fa-circle-info text-info',
            system: 'fa-gear text-secondary'
        };

        const toast = document.createElement('div');
        toast.className = `notification-toast ${colors[type] || colors.system} border-start-4`;
        toast.style.animation = 'notificationSlide 0.4s ease-out';
        toast.innerHTML = `
            <div class="d-flex align-items-start">
                <i class="fas ${icons[type] || icons.system} me-3 mt-1"></i>
                <div class="flex-grow-1">
                    <strong class="d-block">${title}</strong>
                    <span class="small text-muted">${message}</span>
                </div>
                <button class="btn btn-sm btn-outline-secondary ms-2" onclick="this.closest('.notification-toast').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        this.notificationContainer.prepend(toast);

        // Auto-remove after 6 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 300);
            }
        }, 6000);
    }

    // ============================================
    // BROWSER NOTIFICATION
    // ============================================
    _showBrowserNotification(title, message) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body: message, icon: '/favicon.ico' });
        } else if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // ============================================
    // REQUEST PERMISSION
    // ============================================
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

// Make global
window.NotificationService = new NotificationService();

// Request permission on load
document.addEventListener('DOMContentLoaded', () => {
    window.NotificationService.requestNotificationPermission();
});