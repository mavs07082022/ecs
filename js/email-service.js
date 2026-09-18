// ============================================
// EMAIL SERVICE - EmailJS Configuration
// Handles BOTH:
//   - Emergency broadcasts (BCC to all residents)
//   - OTP verification codes (direct to one resident)
// ============================================

const EMAIL_CONFIG = {
    SENDER_EMAIL: 'brgy.culiat.ecs@gmail.com',
    SERVICE_ID: 'service_yeeadci',
    TEMPLATE_ID: 'template_ysihytb',        // emergency broadcasts template
    OTP_TEMPLATE_ID: 'template_dud688h',    // ← PASTE YOUR NEW OTP TEMPLATE ID HERE (looks like: template_abc1234)
    PUBLIC_KEY: 'nd2Bv29k1zeDlfZID',
};

// ============================================
// GENERATE ADVICE
// ============================================
function generateAdvice(type, priority) {
    var advice = '';
    
    if (type === 'fire') {
        advice = 'Immediately evacuate the area if you are near the fire. Call the fire department. Do not attempt to extinguish large fires yourself.';
    } else if (type === 'flood') {
        advice = 'Avoid flooded areas. Move to higher ground immediately. Turn off electricity and gas if safe.';
    } else if (type === 'medical') {
        advice = 'Seek immediate medical attention. Call an ambulance or go to the nearest hospital. Provide first aid only if trained.';
    } else if (type === 'accident') {
        advice = 'Check for injuries and call emergency services. Secure the area. Do not move the injured unless in immediate danger.';
    } else if (type === 'crime') {
        advice = 'Stay safe and do not confront suspects. Call the police immediately. Secure yourself in a safe location.';
    } else {
        advice = 'Stay calm and follow official instructions. Call emergency services if needed. Monitor this system for updates.';
    }
    
    if (priority === 'critical' || priority === 'high') {
        advice += ' URGENT: Immediate action required. Call 911 now.';
    }
    
    return advice;
}

// ============================================
// PREPARE EMAIL PARAMETERS (emergency only)
// ============================================
function prepareEmailParams(incident, isAcknowledged) {
    var priority = (incident.priority || 'medium').toUpperCase();
    var status = isAcknowledged ? 'ACKNOWLEDGED' : 'NEW';
    var title = isAcknowledged ? 'Emergency Acknowledged' : 'New Emergency Report';
    
    var locationDisplay = incident.location || 'Unknown location';
    try {
        if (typeof incident.location === 'string' && incident.location.indexOf('{') !== -1) {
            var loc = JSON.parse(incident.location);
            locationDisplay = loc.address || loc.location || incident.location;
        }
    } catch (e) {}
    
    var time = incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Unknown time';
    var advice = generateAdvice(incident.type, incident.priority);
    var year = new Date().getFullYear();
    
    return {
        subject: '[' + priority + '] ' + (incident.title || 'Emergency Report') + ' - ' + status,
        priority: priority,
        status: status,
        type: incident.type || 'Unknown',
        location: locationDisplay,
        time: time,
        barangay: incident.barangay || '',
        description: incident.description || 'No description provided',
        advice: advice,
        year: year
    };
}

// ============================================
// SEND EMERGENCY EMAIL (BCC bulk to residents)
// ============================================
async function sendEmailEmailJS(to, params) {
    try {
        if (typeof emailjs === 'undefined') {
            await loadEmailJSLibrary();
        }
        
        emailjs.init(EMAIL_CONFIG.PUBLIC_KEY);
        
        // Convert array to comma-separated string for BCC
        var toEmails = Array.isArray(to) ? to.join(', ') : to;
        
        var templateParams = {
            to_email: EMAIL_CONFIG.SENDER_EMAIL, // Send to yourself (or a dummy)
            bcc_email: toEmails,                 // BCC all recipients
            subject: params.subject || 'Emergency Alert',
            priority: params.priority || 'MEDIUM',
            status: params.status || 'NEW',
            type: params.type || 'Unknown',
            location: params.location || 'Unknown location',
            time: params.time || new Date().toLocaleString(),
            barangay: params.barangay || '',
            description: params.description || 'No description provided',
            advice: params.advice || 'Stay calm and call 911 if needed.',
            year: params.year || new Date().getFullYear()
        };
        
        console.log('Sending emergency email to ' + (Array.isArray(to) ? to.length : 1) + ' recipients');
        console.log('Recipients:', toEmails);
        
        var response = await emailjs.send(
            EMAIL_CONFIG.SERVICE_ID,
            EMAIL_CONFIG.TEMPLATE_ID,
            templateParams
        );
        
        console.log('Email sent! Status:', response.status);
        return { success: true, messageId: response.text };

    } catch (error) {
        console.error('EmailJS Error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// SEND OTP EMAIL (direct to ONE resident)
// Uses the dedicated OTP template
// ============================================
async function sendOTPEmailJS(email, otp, fullName) {
    try {
        if (typeof emailjs === 'undefined') {
            await loadEmailJSLibrary();
        }
        if (typeof emailjs === 'undefined') {
            throw new Error('EmailJS not available');
        }

        // Use OTP_TEMPLATE_ID when configured, fall back to TEMPLATE_ID
        var templateId = EMAIL_CONFIG.OTP_TEMPLATE_ID || EMAIL_CONFIG.TEMPLATE_ID;

        emailjs.init(EMAIL_CONFIG.PUBLIC_KEY);

        var templateParams = {
            to_email: email,                          // ✅ resident is the real recipient
            to_name: fullName || 'Resident',
            bcc_email: '',                            // ✅ no Bcc — direct send
            subject: 'Your Barangay Culiat Login Verification Code',
            otp_code: otp,                            // matches {{otp_code}} in template
            priority: 'SECURITY',
            status: 'OTP',
            type: 'Login Verification',
            location: 'Barangay Culiat ECS',
            time: new Date().toLocaleString(),
            barangay: '',
            description: 'Your one-time login code is: ' + otp + '. This code expires in 10 minutes. Do not share it with anyone.',
            advice: 'Hello ' + (fullName || 'Resident') + ', use the code above to complete your login. If you did not request this, please ignore this email and consider changing your password.',
            year: new Date().getFullYear()
        };

        console.log('📧 Sending OTP to:', email);
        console.log('📧 Using OTP template:', templateId);

        var response = await emailjs.send(
            EMAIL_CONFIG.SERVICE_ID,
            templateId,
            templateParams
        );

        console.log('📧 OTP email sent:', response.status);
        return { success: true, response: response };

    } catch (error) {
        console.error('OTP email send failed:', error);
        return { success: false, error: error.message || 'Failed to send OTP email' };
    }
}

// ============================================
// LOAD EMAILJS LIBRARY
// ============================================
function loadEmailJSLibrary() {
    return new Promise(function(resolve, reject) {
        if (typeof emailjs !== 'undefined') {
            resolve();
            return;
        }
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
        script.async = true;
        script.onload = function() { resolve(); };
        script.onerror = function() { reject(new Error('Failed to load EmailJS')); };
        document.head.appendChild(script);
    });
}

// ============================================
// GET ALL USER EMAILS
// ============================================
async function getAllUserEmails() {
    try {
        var result = await supabaseClient
            .from('profiles')
            .select('email, barangay, full_name')
            .not('email', 'is', null)
            .neq('email', '');
        if (result.error) throw result.error;
        return result.data.filter(function(p) { return p.email && p.email.length > 0; });
    } catch (error) {
        console.error('Error fetching user emails:', error);
        return [];
    }
}

// ============================================
// SEND EMERGENCY NOTIFICATION
// ============================================
async function sendEmergencyEmailNotification(incident, isAcknowledged) {
    try {
        console.log('Sending ' + (isAcknowledged ? 'acknowledgment' : 'new') + ' email...');
        
        if (typeof emailjs === 'undefined') {
            try { await loadEmailJSLibrary(); } catch (e) {
                return { success: false, error: 'EmailJS not loaded' };
            }
        }
        
        var users = await getAllUserEmails();
        console.log('Total users found:', users.length);
        
        if (!users || users.length === 0) {
            return { success: false, error: 'No users found' };
        }
        
        // Log all users for debugging
        users.forEach(function(u) {
            console.log('User:', u.email, 'Barangay:', u.barangay);
        });
        
        // Filter users by barangay
        var filteredUsers = users;
        if (incident.barangay) {
            filteredUsers = users.filter(function(u) { 
                return u.barangay === incident.barangay; 
            });
            console.log('Filtered to ' + filteredUsers.length + ' users in barangay ' + incident.barangay);
        }
        
        // If no users in barangay, send to all
        if (filteredUsers.length === 0) {
            filteredUsers = users;
            console.log('Sending to all ' + filteredUsers.length + ' users instead');
        }
        
        // Get all emails
        var emails = filteredUsers.map(function(u) { return u.email; });
        console.log('Sending to emails:', emails);
        
        // Prepare params
        var params = prepareEmailParams(incident, isAcknowledged);
        
        // Send to ALL recipients at once (using BCC)
        var result = await sendEmailEmailJS(emails, params);
        
        // Log to database
        try {
            await supabaseClient
                .from('email_notifications')
                .insert([{
                    incident_id: incident.id,
                    recipients_count: emails.length,
                    subject: params.subject,
                    body: params.description,
                    status: result.success ? 'sent' : 'failed',
                    sent_at: new Date().toISOString(),
                    error_message: result.success ? null : (result.error || 'Unknown error')
                }]);
        } catch (logError) {
            console.warn('Could not log email:', logError);
        }
        
        console.log('Email complete: ' + emails.length + ' recipients');
        return result;

    } catch (error) {
        console.error('Email error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// TEST EMAIL
// ============================================
async function testEmail() {
    try {
        console.log('Running email test...');
        
        if (typeof emailjs === 'undefined') {
            try { await loadEmailJSLibrary(); } catch (e) {
                if (typeof showToast === 'function') {
                    showToast('Failed to load EmailJS. Please refresh.', 'danger', 5000);
                }
                return { success: false, error: 'EmailJS not loaded' };
            }
        }
        
        var testIncident = {
            id: 'test-' + Date.now(),
            type: 'fire',
            title: 'Test: Email Notification System',
            description: 'This is a test email from the Barangay Culiat Emergency Communication System. Your email system is working correctly.',
            priority: 'high',
            location: 'Barangay Culiat, Test Location',
            barangay: 'Test Barangay',
            created_at: new Date().toISOString(),
            status: 'reported'
        };
        
        var result = await sendEmergencyEmailNotification(testIncident, false);
        
        if (result.success) {
            if (typeof showToast === 'function') {
                showToast('Test email sent successfully! Check your inbox.', 'success', 5000);
            }
            console.log('Test email sent successfully');
        } else {
            if (typeof showToast === 'function') {
                showToast('Test email failed: ' + (result.error || 'Unknown error'), 'danger', 5000);
            }
            console.error('Test email failed:', result.error);
        }
        
        return result;
    } catch (error) {
        console.error('Test email error:', error);
        if (typeof showToast === 'function') {
            showToast('Test email failed: ' + error.message, 'danger', 5000);
        }
        return { success: false, error: error.message };
    }
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================
window.sendEmergencyEmailNotification = sendEmergencyEmailNotification;
window.sendEmailEmailJS = sendEmailEmailJS;
window.sendOTPEmailJS = sendOTPEmailJS;         // ← new, exposed for auth-security.js
window.testEmail = testEmail;
window.getAllUserEmails = getAllUserEmails;
window.EMAIL_CONFIG = EMAIL_CONFIG;

console.log('Email service initialized');
console.log('Sender:', EMAIL_CONFIG.SENDER_EMAIL);
console.log('Emergency template:', EMAIL_CONFIG.TEMPLATE_ID);
console.log('OTP template:', EMAIL_CONFIG.OTP_TEMPLATE_ID);
console.log('Test with: testEmail()');
