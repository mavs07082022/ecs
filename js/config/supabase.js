// js/config/supabase.js

// ============================================
// SUPABASE CONFIGURATION
// ============================================
// 🔥 REPLACE WITH YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://outrmkukczdfffewsyjp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dHJta3VrY3pkZmZmZXdzeWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzE3MzYsImV4cCI6MjEwMTQwNzczNn0.xJY21cjl-AQsRW3WNdfzs3t1GqnwybzN9oxDwRGV94Y';

// Initialize Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

// Make global
window.supabase = supabaseClient;

// ============================================
// CONNECTION TEST
// ============================================
async function testSupabaseConnection() {
    try {
        const { data, error } = await supabaseClient
            .from('emergencies')
            .select('count', { count: 'exact', head: true });
        
        if (error) {
            console.warn('⚠️ Supabase connection test:', error.message);
            return false;
        }
        
        console.log('✅ Supabase connected successfully');
        return true;
    } catch (error) {
        console.error('❌ Supabase connection failed:', error);
        return false;
    }
}

// ============================================
// EXPOSE
// ============================================
const SupabaseConfig = {
    client: supabaseClient,
    testConnection: testSupabaseConnection,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
};

window.SupabaseConfig = SupabaseConfig;

// Auto-test connection
document.addEventListener('DOMContentLoaded', () => {
    testSupabaseConnection();
});