// ============================================
// GEMINI AI CONFIGURATION
// ============================================
// Get your free key: https://aistudio.google.com/app/apikey
// Free tier: ~15 req/min, ~1500 req/day

window.GEMINI_CONFIG = {
    // ⬇️ PASTE YOUR KEY HERE (replace the placeholder)
    API_KEY: 'AQ.Ab8RN6KPAvO2zHirC7FNdD5eORZ1VMM7peYmRt36EvmWcWEb1Q',

    // Model
    MODEL: 'gemini-2.0-flash',

    // Fallback if AI unavailable
    ENABLE_FALLBACK: true,

    // Cache identical reports (saves quota)
    ENABLE_CACHE: true,
    CACHE_TTL_MS: 5 * 60 * 1000,

    // Auto-detect incident type from title/description
    AUTO_DETECT_TYPE: true
};

console.log('⚙️ Gemini config loaded. Key set:', window.GEMINI_CONFIG.API_KEY.indexOf('PASTE_YOUR') === -1);