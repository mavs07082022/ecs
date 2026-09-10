// js/auth/auth.js

// ============================================
// AUTH STATE
// ============================================
let currentUser = null;
let authModalInstance = null;

// ============================================
// INIT AUTH
// ============================================
async function initAuth() {
    try {
        const { data: { session } } = await window.supabase.auth.getSession();
        
        if (session?.user) {
            currentUser = session.user;
            await loadUserProfile();
            updateUIForLoggedInUser();
        } else {
            updateUIForLoggedOutUser();
        }
    } catch (error) {
        console.error('Auth init error:', error);
    }

    // Listen for auth changes
    window.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
            currentUser = session.user;
            loadUserProfile();
            updateUIForLoggedInUser();
            showNotification('Welcome back!', 'Logged in successfully', 'success');
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            updateUIForLoggedOutUser();
            showNotification('Logged out', 'You have been signed out', 'info');
        }
    });
}

// ============================================
// LOAD USER PROFILE
// ============================================
async function loadUserProfile() {
    if (!currentUser) return;

    try {
        const { data, error } = await window.supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error) throw error;
        
        currentUser.profile = data;
        
        // Update display
        const nameDisplay = document.getElementById('userNameDisplay');
        if (nameDisplay) {
            nameDisplay.textContent = data.name || currentUser.email;
        }
        
        const roleDisplay = document.getElementById('userRoleDisplay');
        if (roleDisplay) {
            roleDisplay.textContent = data.role || 'public';
        }

        return data;

    } catch (error) {
        console.error('Error loading profile:', error);
        return null;
    }
}

// ============================================
// REGISTER
// ============================================
async function registerUser(email, password, name, phone, role, responderCode = '') {
    try {
        // Check responder code for responder role
        if (role === 'responder' && responderCode !== 'RESPONDER2024') {
            throw new Error('Invalid responder code. Please contact your barangay administrator.');
        }

        // Sign up with metadata
        const { data, error } = await window.supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name,
                    phone,
                    role: role || 'public'
                }
            }
        });

        if (error) throw error;

        showNotification('Registration successful!', 'Please check your email to verify your account.', 'success');
        return data;

    } catch (error) {
        console.error('Registration error:', error);
        showNotification('Registration failed', error.message, 'error');
        throw error;
    }
}

// ============================================
// LOGIN
// ============================================
async function loginUser(email, password) {
    try {
        const { data, error } = await window.supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        showNotification('Welcome!', 'You have been logged in successfully.', 'success');
        return data;

    } catch (error) {
        console.error('Login error:', error);
        showNotification('Login failed', error.message, 'error');
        throw error;
    }
}

// ============================================
// LOGOUT
// ============================================
async function logoutUser() {
    try {
        await window.supabase.auth.signOut();
        showNotification('Logged out', 'You have been signed out.', 'info');
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('Logout failed', error.message, 'error');
    }
}

// ============================================
// UPDATE UI
// ============================================
function updateUIForLoggedInUser() {
    const authButtons = document.getElementById('authButtons');
    const userInfo = document.getElementById('userInfo');
    
    if (authButtons) authButtons.classList.add('d-none');
    if (userInfo) userInfo.classList.remove('d-none');
}

function updateUIForLoggedOutUser() {
    const authButtons = document.getElementById('authButtons');
    const userInfo = document.getElementById('userInfo');
    
    if (authButtons) authButtons.classList.remove('d-none');
    if (userInfo) userInfo.classList.add('d-none');
}

// ============================================
// AUTH MODAL
// ============================================
function showAuthModal(mode = 'login') {
    const modal = document.getElementById('authModal');
    if (!modal) return;

    const modalInstance = new bootstrap.Modal(modal);
    authModalInstance = modalInstance;

    // Set mode
    const isLogin = mode === 'login';
    document.getElementById('authModalTitle').textContent = isLogin ? 'Welcome Back' : 'Create Account';
    document.getElementById('authSubmitBtn').innerHTML = isLogin ? 
        '<i class="fas fa-arrow-right me-2"></i>Login' : 
        '<i class="fas fa-user-plus me-2"></i>Register';
    
    document.getElementById('registerFields').classList.toggle('d-none', isLogin);
    document.getElementById('authToggleText').textContent = isLogin ? 
        "Don't have an account? Register" : 
        'Already have an account? Login';

    // Clear form
    document.getElementById('authEmail').value = '';
    document.getElementById('authPassword').value = '';
    document.getElementById('registerName').value = '';
    document.getElementById('registerPhone').value = '';
    document.getElementById('authError').classList.add('d-none');

    modalInstance.show();
}

// ============================================
// TOGGLE AUTH MODE
// ============================================
function toggleAuthMode(event) {
    if (event) event.preventDefault();
    
    const isLogin = document.getElementById('authToggleText').textContent.includes('Register');
    showAuthModal(isLogin ? 'register' : 'login');
}

// ============================================
// TOGGLE PASSWORD VISIBILITY
// ============================================
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('authPassword');
    const icon = document.getElementById('passwordToggleIcon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        passwordInput.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// ============================================
// TOGGLE RESPONDER CODE
// ============================================
function toggleResponderCode() {
    const role = document.getElementById('registerRole').value;
    const field = document.getElementById('responderCodeField');
    field.style.display = role === 'responder' ? 'block' : 'none';
}

// ============================================
// HANDLE AUTH SUBMIT
// ============================================
async function handleAuthSubmit(event) {
    event.preventDefault();
    
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const errorDiv = document.getElementById('authError');
    errorDiv.classList.add('d-none');

    const isLogin = document.getElementById('authToggleText').textContent.includes('Register');

    try {
        if (isLogin) {
            await loginUser(email, password);
            if (authModalInstance) authModalInstance.hide();
        } else {
            const name = document.getElementById('registerName').value;
            const phone = document.getElementById('registerPhone').value;
            const role = document.getElementById('registerRole').value;
            const responderCode = document.getElementById('responderCode').value;

            if (!name || !phone) {
                throw new Error('Please fill in all required fields');
            }

            // Validate phone number
            const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
            const phoneRegex = /^(09|\+63)[0-9]{9}$/;
            if (!phoneRegex.test(cleanPhone)) {
                throw new Error('Please enter a valid Philippine phone number (e.g., 09123456789)');
            }

            await registerUser(email, password, name, cleanPhone, role, responderCode);
            if (authModalInstance) authModalInstance.hide();
        }
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('d-none');
    }
}

// ============================================
// NOTIFICATION HELPER
// ============================================
function showNotification(title, message, type = 'info') {
    if (window.NotificationService) {
        window.NotificationService._showToast(title, message, type);
    } else {
        console.log(`[${type}] ${title}: ${message}`);
    }
}

// ============================================
// CHECK IF LOGGED IN
// ============================================
function isLoggedIn() {
    return !!currentUser;
}

function getCurrentUser() {
    return currentUser;
}

function getCurrentUserProfile() {
    return currentUser?.profile || null;
}

// ============================================
// EXPOSE
// ============================================
window.Auth = {
    init: initAuth,
    register: registerUser,
    login: loginUser,
    logout: logoutUser,
    isLoggedIn,
    getCurrentUser,
    getCurrentUserProfile,
    showAuthModal,
    toggleAuthMode,
    handleAuthSubmit,
    togglePasswordVisibility,
    toggleResponderCode
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
    window.Auth.init();
});