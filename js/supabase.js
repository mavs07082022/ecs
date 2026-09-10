// ============================================
// SUPABASE CLIENT CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://outrmkukczdfffewsyjp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dHJta3VrY3pkZmZmZXdzeWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzE3MzYsImV4cCI6MjEwMTQwNzczNn0.xJY21cjl-AQsRW3WNdfzs3t1GqnwybzN9oxDwRGV94Y';

const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dHJta3VrY3pkZmZmZXdzeWpwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgzMTczNiwiZXhwIjoyMTAxNDA3NzM2fQ.C4m8Df2tkeFJvz4nm1-42NjtN3wkRxSODC7Pu31HOGk';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
    },
    realtime: {
        params: {
            eventsPerSecond: 10,
            log_level: 'info'
        }
    }
});

const supabaseAdmin = window.supabase.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
});

// ============================================
// EXPOSE TO GLOBAL WINDOW
// ============================================
window.supabaseClient = supabaseClient;
window.supabaseAdmin = supabaseAdmin;

console.log('🔗 Supabase clients initialized');

// ============================================
// LOAD EMAIL SERVICE
// ============================================
(function loadEmailService() {
    // Check if already loaded
    if (typeof window.sendEmergencyEmailNotification === 'function') {
        console.log('✅ Email service already loaded');
        return;
    }
    
    console.log('📧 Loading email service...');
    
    // Try multiple possible paths
    var possiblePaths = [
        'js/email-service.js',
        '../js/email-service.js',
        './js/email-service.js'
    ];
    
    // Try to load the script
    function tryLoadScript(paths, index) {
        if (index >= paths.length) {
            console.warn('⚠️ Failed to load email-service.js from all paths');
            return;
        }
        
        var script = document.createElement('script');
        script.src = paths[index];
        script.async = true;
        script.onload = function() {
            console.log('✅ Email service loaded successfully from: ' + paths[index]);
            console.log('📧 Sender: ' + (window.EMAIL_CONFIG?.SENDER_EMAIL || 'Not configured'));
            console.log('📧 Test: testEmail()');
        };
        script.onerror = function() {
            console.warn('⚠️ Failed to load from: ' + paths[index]);
            tryLoadScript(paths, index + 1);
        };
        document.head.appendChild(script);
    }
    
    // Start trying to load from the first path
    tryLoadScript(possiblePaths, 0);
})();

// Fallback testEmail function if service fails to load
if (typeof window.testEmail !== 'function') {
    window.testEmail = function() {
        console.log('📧 testEmail called (fallback)');
        if (typeof showToast === 'function') {
            showToast('⚠️ Email service not loaded. Please refresh the page.', 'warning');
        }
    };
}