/* ============================================================
   Culiat Public Safety — Auth Security Module
   Handles: OTP verification, inactivity logout, session guards
   ============================================================ */

(function () {
  "use strict";

  // ============================================
  // CONFIG
  // ============================================
  const SECURITY_CONFIG = {
    OTP_LENGTH: 6,
    OTP_EXPIRY_MS: 10 * 60 * 1000, // 10 minutes
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_MS: 60 * 1000, // 60 seconds
    INACTIVITY_TIMEOUT_MS: 2 * 60 * 1000, // 2 minutes (auto-logout)
    INACTIVITY_WARNING_MS: 60 * 1000, // warn 60s before
    SESSION_FLAG_KEY: 'culiat_otp_verified_session',
    LAST_ACTIVITY_KEY: 'culiat_last_activity',
    SESSION_START_KEY: 'culiat_session_start'
  };

  const OTP_STORAGE_PREFIX = 'culiat_otp_';
  const OTP_ATTEMPT_PREFIX = 'culiat_otp_attempts_';
  const OTP_RESEND_PREFIX = 'culiat_otp_resend_';

  // ============================================
  // UTILITIES
  // ============================================
  function generateOTP() {
    let otp = '';
    const array = new Uint32Array(SECURITY_CONFIG.OTP_LENGTH);
    crypto.getRandomValues(array);
    for (let i = 0; i < SECURITY_CONFIG.OTP_LENGTH; i++) {
      otp += (array[i] % 10).toString();
    }
    return otp;
  }

  function hashOTP(otp, salt) {
    // Simple hash for storage (not cryptographic-strength, but
    // prevents casual plaintext reading from localStorage)
    let hash = 0;
    const str = otp + ':' + salt;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return String(hash);
  }

  function getSessionId() {
    // Generate a stable per-browser-tab session id
    let sid = sessionStorage.getItem('culiat_session_id');
    if (!sid) {
      sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      sessionStorage.setItem('culiat_session_id', sid);
    }
    return sid;
  }

  function isOtpVerifiedForSession() {
    try {
      const raw = sessionStorage.getItem(SECURITY_CONFIG.SESSION_FLAG_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data && data.verified === true && data.sessionId === getSessionId();
    } catch (e) {
      return false;
    }
  }

  function markOtpVerified(email) {
    sessionStorage.setItem(SECURITY_CONFIG.SESSION_FLAG_KEY, JSON.stringify({
      verified: true,
      email: email,
      sessionId: getSessionId(),
      verifiedAt: Date.now()
    }));
  }

  function clearOtpVerification() {
    sessionStorage.removeItem(SECURITY_CONFIG.SESSION_FLAG_KEY);
  }

  // ============================================
  // OTP CREATION & VALIDATION
  // ============================================
  function createOTP(email) {
    const otp = generateOTP();
    const salt = Math.random().toString(36).substring(2, 12);
    const payload = {
      hash: hashOTP(otp, salt),
      salt: salt,
      email: email.toLowerCase(),
      createdAt: Date.now(),
      expiresAt: Date.now() + SECURITY_CONFIG.OTP_EXPIRY_MS
    };
    localStorage.setItem(OTP_STORAGE_PREFIX + email.toLowerCase(), JSON.stringify(payload));
    localStorage.removeItem(OTP_ATTEMPT_PREFIX + email.toLowerCase());
    return otp;
  }

  function validateOTP(email, inputOtp) {
    const key = OTP_STORAGE_PREFIX + email.toLowerCase();
    const raw = localStorage.getItem(key);
    if (!raw) return { valid: false, reason: 'no_otp', message: 'No OTP found. Please request a new one.' };

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return { valid: false, reason: 'corrupt', message: 'Invalid OTP data. Please request a new one.' };
    }

    if (Date.now() > payload.expiresAt) {
      localStorage.removeItem(key);
      return { valid: false, reason: 'expired', message: 'OTP has expired. Please request a new one.' };
    }

    // Attempt tracking
    const attemptsKey = OTP_ATTEMPT_PREFIX + email.toLowerCase();
    let attempts = parseInt(localStorage.getItem(attemptsKey) || '0', 10);
    if (attempts >= SECURITY_CONFIG.OTP_MAX_ATTEMPTS) {
      localStorage.removeItem(key);
      localStorage.removeItem(attemptsKey);
      return { valid: false, reason: 'max_attempts', message: 'Too many failed attempts. Please request a new OTP.' };
    }

    const expected = hashOTP(inputOtp, payload.salt);
    if (expected !== payload.hash) {
      attempts += 1;
      localStorage.setItem(attemptsKey, String(attempts));
      const remaining = SECURITY_CONFIG.OTP_MAX_ATTEMPTS - attempts;
      return {
        valid: false,
        reason: 'mismatch',
        remaining: remaining,
        message: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      };
    }

    // Success — clean up
    localStorage.removeItem(key);
    localStorage.removeItem(attemptsKey);
    return { valid: true };
  }

  function canResendOTP(email) {
    const key = OTP_RESEND_PREFIX + email.toLowerCase();
    const last = parseInt(localStorage.getItem(key) || '0', 10);
    const elapsed = Date.now() - last;
    if (elapsed < SECURITY_CONFIG.OTP_RESEND_COOLDOWN_MS) {
      return {
        allowed: false,
        waitMs: SECURITY_CONFIG.OTP_RESEND_COOLDOWN_MS - elapsed
      };
    }
    return { allowed: true };
  }

  function markOTPResent(email) {
    localStorage.setItem(OTP_RESEND_PREFIX + email.toLowerCase(), String(Date.now()));
  }

  // ============================================
  // SEND OTP EMAIL (via EmailJS)
  // ============================================
  async function sendOTPEmail(email, otp, fullName) {
    try {
      if (typeof emailjs === 'undefined') {
        await loadEmailJS();
      }
      if (typeof emailjs === 'undefined') {
        throw new Error('EmailJS not available');
      }

      // Reuse the existing EMAIL_CONFIG from email-service.js
      const cfg = window.EMAIL_CONFIG || {
        SERVICE_ID: 'service_yeeadci',
        TEMPLATE_ID: 'template_ysihytb',
        PUBLIC_KEY: 'nd2Bv29k1zeDlfZID',
        SENDER_EMAIL: 'brgy.culiat.ers@gmail.com'
      };

      emailjs.init(cfg.PUBLIC_KEY);

      const params = {
        to_email: email,
        bcc_email: '',
        subject: 'Your Barangay Culiat Login Verification Code',
        priority: 'SECURITY',
        status: 'OTP',
        type: 'Login Verification',
        location: 'Barangay Culiat ECS',
        time: new Date().toLocaleString(),
        barangay: '',
        description: `Your one-time login code is: ${otp}. This code expires in 10 minutes. Do not share it with anyone.`,
        advice: `Hello ${fullName || 'Resident'}, use the code above to complete your login. If you did not request this, please ignore this email and consider changing your password.`,
        year: new Date().getFullYear(),
        otp_code: otp
      };

      const response = await emailjs.send(cfg.SERVICE_ID, cfg.TEMPLATE_ID, params);
      return { success: true, response: response };
    } catch (error) {
      console.error('OTP email send failed:', error);
      return { success: false, error: error.message || 'Failed to send OTP email' };
    }
  }

  function loadEmailJS() {
    return new Promise(function (resolve) {
      if (typeof emailjs !== 'undefined') return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  // ============================================
  // INACTIVITY AUTO-LOGOUT
  // ============================================
  let inactivityTimer = null;
  let warningTimer = null;
  let warningShown = false;
  let activityBound = false;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (warningTimer) clearTimeout(warningTimer);
    warningShown = false;
    hideInactivityWarning();

    try {
      localStorage.setItem(SECURITY_CONFIG.LAST_ACTIVITY_KEY, String(Date.now()));
    } catch (e) {}

    warningTimer = setTimeout(showInactivityWarning, SECURITY_CONFIG.INACTIVITY_TIMEOUT_MS - SECURITY_CONFIG.INACTIVITY_WARNING_MS);
    inactivityTimer = setTimeout(performAutoLogout, SECURITY_CONFIG.INACTIVITY_TIMEOUT_MS);
  }

  function showInactivityWarning() {
    if (warningShown) return;
    warningShown = true;

    let overlay = document.getElementById('inactivityWarningOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'inactivityWarningOverlay';
      overlay.innerHTML = `
        <div class="inactivity-warning-box">
          <div class="inactivity-warning-icon">
            <i class="fas fa-clock"></i>
          </div>
          <h4 class="inactivity-warning-title">Still there?</h4>
          <p class="inactivity-warning-text">
            You've been inactive. For your security, you'll be automatically logged out in
            <strong id="inactivityCountdown">60</strong> seconds.
          </p>
          <div class="inactivity-warning-actions">
            <button type="button" class="btn-civic btn-primary" id="stayLoggedInBtn">
              <i class="fas fa-user-check"></i> Stay Logged In
            </button>
            <button type="button" class="btn-civic btn-outline" id="logoutNowBtn">
              <i class="fas fa-sign-out-alt"></i> Logout Now
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.classList.add('show');

    // Countdown
    let remaining = Math.floor(SECURITY_CONFIG.INACTIVITY_WARNING_MS / 1000);
    const countdownEl = document.getElementById('inactivityCountdown');
    if (countdownEl) countdownEl.textContent = remaining;

    const countdownInterval = setInterval(function () {
      remaining -= 1;
      if (countdownEl) countdownEl.textContent = remaining > 0 ? remaining : 0;
      if (remaining <= 0) clearInterval(countdownInterval);
    }, 1000);

    overlay.dataset.intervalId = String(countdownInterval);

    document.getElementById('stayLoggedInBtn')?.addEventListener('click', function () {
      clearInterval(countdownInterval);
      warningShown = false;
      hideInactivityWarning();
      resetInactivityTimer();
      if (typeof showToast === 'function') showToast('Session extended', 'success', 2500);
    }, { once: true });

    document.getElementById('logoutNowBtn')?.addEventListener('click', function () {
      clearInterval(countdownInterval);
      performAutoLogout(true);
    }, { once: true });
  }

  function hideInactivityWarning() {
    const overlay = document.getElementById('inactivityWarningOverlay');
    if (!overlay) return;
    const id = overlay.dataset.intervalId;
    if (id) clearInterval(parseInt(id, 10));
    overlay.classList.remove('show');
  }

  async function performAutoLogout(manual) {
    try {
      if (window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
    } catch (e) {}
    clearOtpVerification();
    try {
      localStorage.removeItem(SECURITY_CONFIG.LAST_ACTIVITY_KEY);
      localStorage.removeItem(SECURITY_CONFIG.SESSION_START_KEY);
    } catch (e) {}

    if (!manual && typeof showToast === 'function') {
      showToast('You have been logged out due to inactivity.', 'warning', 5000);
    }

    // Determine redirect path
    const path = window.location.pathname;
    let redirect = '../index.html';
    if (path.indexOf('/resident/') !== -1 || path.indexOf('/responder/') !== -1) {
      redirect = '../index.html';
    } else if (path.indexOf('/admin/') !== -1) {
      redirect = '../index.html';
    }
    setTimeout(function () { window.location.href = redirect; }, manual ? 200 : 1200);
  }

  function bindActivityListeners() {
    if (activityBound) return;
    activityBound = true;
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange'];
    let throttleTimer = null;
    function handler() {
      if (document.visibilityState === 'hidden') return;
      if (throttleTimer) return;
      throttleTimer = setTimeout(function () {
        throttleTimer = null;
        resetInactivityTimer();
      }, 5000); // throttle to every 5s
    }
    events.forEach(function (evt) {
      document.addEventListener(evt, handler, { passive: true });
    });
  }

  function startInactivityWatch() {
    bindActivityListeners();
    resetInactivityTimer();
  }

  function stopInactivityWatch() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (warningTimer) clearTimeout(warningTimer);
    hideInactivityWarning();
  }

  // ============================================
  // PASSWORD STRENGTH
  // ============================================
  function scorePassword(pwd) {
    if (!pwd) return { score: 0, label: 'Too short', color: '#dc3545', checks: {} };
    const checks = {
      length: pwd.length >= 8,
      upper: /[A-Z]/.test(pwd),
      lower: /[a-z]/.test(pwd),
      digit: /[0-9]/.test(pwd),
      special: /[^A-Za-z0-9]/.test(pwd),
      long: pwd.length >= 12
    };
    let score = 0;
    Object.keys(checks).forEach(function (k) {
      if (checks[k]) score += 1;
    });

    let label, color;
    if (score <= 2) { label = 'Weak'; color = '#dc3545'; }
    else if (score === 3) { label = 'Fair'; color = '#fd7e14'; }
    else if (score === 4) { label = 'Good'; color = '#ffc107'; }
    else if (score === 5) { label = 'Strong'; color = '#28a745'; }
    else { label = 'Very Strong'; color = '#20c997'; }

    return { score: score, max: 6, label: label, color: color, checks: checks };
  }

  // ============================================
  // EXPOSE
  // ============================================
  window.CuliatAuthSecurity = {
    CONFIG: SECURITY_CONFIG,
    generateOTP: generateOTP,
    createOTP: createOTP,
    validateOTP: validateOTP,
    canResendOTP: canResendOTP,
    markOTPResent: markOTPResent,
    sendOTPEmail: sendOTPEmail,
    isOtpVerifiedForSession: isOtpVerifiedForSession,
    markOtpVerified: markOtpVerified,
    clearOtpVerification: clearOtpVerification,
    startInactivityWatch: startInactivityWatch,
    stopInactivityWatch: stopInactivityWatch,
    resetInactivityTimer: resetInactivityTimer,
    scorePassword: scorePassword,
    performAutoLogout: performAutoLogout
  };

  console.log('🔐 Culiat Auth Security module initialized');
})();