/* ============================================================
   Culiat Public Safety — AI Chatbot Assistant (v1)
   Smart rule-based + fuzzy matching knowledge base
   ============================================================ */

(function () {
  "use strict";

  // ============================================
  // STATE
  // ============================================
  let chatbotOpen = false;
  let isTyping = false;
  let conversationHistory = [];
  let hasWelcomed = false;

  const STORAGE_KEY = 'culiat_chatbot_history';
  const MAX_HISTORY = 30;

  // ============================================
  // KNOWLEDGE BASE
  // ============================================
  const KNOWLEDGE = [
    // ─── GREETINGS ───
    {
      id: 'greeting',
      patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'kumusta', 'kamusta', 'musta', 'helo', 'yo'],
      response: `Hello! 👋 I'm the **Culiat Assistant**. I can help you with:\n\n• 🚨 Emergency hotlines & contacts\n• 📱 How to report an emergency\n• 🗺️ Barangay Culiat location info\n• 🔒 Account & login help\n• 🤖 How the AI system works\n• ❓ General questions about the system\n\nWhat would you like to know?`,
      quickReplies: ['Emergency hotlines', 'How to report', 'System features', 'Login help']
    },
    {
      id: 'thanks',
      patterns: ['thank', 'thanks', 'salamat', 'ty', 'appreciate', 'grateful'],
      response: `You're welcome! 😊 Stay safe always. If you need anything else, I'm right here.`,
      quickReplies: ['Emergency hotlines', 'System features']
    },
    {
      id: 'bye',
      patterns: ['bye', 'goodbye', 'paalam', 'see you', 'cya'],
      response: `Goodbye! 👋 Stay safe, and remember — in a real emergency, always call **911** first.`,
      quickReplies: []
    },
    {
      id: 'who-are-you',
      patterns: ['who are you', 'what are you', 'your name', 'sino ka', 'ano ka'],
      response: `I'm the **Culiat Assistant** — an AI helper for the Barangay Culiat Emergency Communication System. 🤖\n\nI can answer questions about:\n• Emergency procedures and hotlines\n• How to use the system\n• Barangay information\n• Account and login help`,
      quickReplies: ['What can you do?', 'Emergency hotlines']
    },
    {
      id: 'capabilities',
      patterns: ['what can you do', 'help me', 'what do you know', 'ano kaya mo', 'features mo', 'capabilities'],
      response: `Here's what I can help with: 🎯\n\n**🚨 Emergency Info**\n• Hotlines and contacts\n• What to do in different emergencies\n\n**📱 System Help**\n• How to report an incident\n• Login and account issues\n• Understanding AI analysis\n\n**🗺️ Barangay Info**\n• Location and coverage area\n• Services offered\n\n**❓ General**\n• FAQs about the system\n\nJust ask away!`,
      quickReplies: ['Emergency hotlines', 'How to report', 'Barangay info']
    },

    // ─── EMERGENCY HOTLINES ───
    {
      id: 'hotlines',
      patterns: ['hotline', 'emergency number', 'contact number', 'phone number', 'tawag', 'numero', 'contact', 'emergency contact', 'sino tatawagan'],
      response: `📞 **Emergency Hotlines — Barangay Culiat**\n\n**National Emergency:**\n• 🚨 **911** — Police, Fire, Medical\n\n**Barangay Culiat:**\n• 📱 **0962-582-1531**\n• ☎️ **856-722-60**\n• ✉️ **brgy.culiat@yahoo.com**\n\n**Specialized:**\n• 🚒 **BFP (Fire):** 911 or (02) 8426-0219\n• 👮 **PNP (Police):** 117 or 911\n• 🚑 **Medical:** 911\n\n⚠️ **In a real emergency, always call 911 first!**`,
      quickReplies: ['Fire emergency', 'Medical emergency', 'Crime report']
    },
    {
      id: 'fire-hotline',
      patterns: ['fire hotline', 'bfp', 'fire department', 'bumbero', 'sunog tawag', 'fire contact'],
      response: `🚒 **Fire Emergency — Bureau of Fire Protection (BFP)**\n\n• **National:** 911\n• **BFP Hotline:** (02) 8426-0219\n• **BFP QC:** (02) 8928-6061\n\n**What to do in a fire:**\n1. Stay calm — get out fast\n2. Call 911 or BFP\n3. Use stairs, never elevators\n4. If smoke, crawl low\n5. Once out, stay out\n\nYou can also report fire via this system with photos and location.`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },
    {
      id: 'medical-hotline',
      patterns: ['medical hotline', 'ambulance', 'hospital', 'doctor', 'medical emergency', 'ems', 'sugat', 'sakit'],
      response: `🚑 **Medical Emergency**\n\n• **Emergency:** 911\n• **Ambulance:** 911\n• **Nearest Hospitals:**\n  - East Avenue Medical Center\n  - Quezon City General Hospital\n  - Veterans Memorial Medical Center\n\n**What to do:**\n1. Call 911 immediately\n2. Keep the patient calm\n3. Do NOT move injured persons unless in danger\n4. Perform CPR only if trained\n5. Report via this system for faster dispatch`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },
    {
      id: 'crime-hotline',
      patterns: ['crime hotline', 'police', 'pulis', 'crime', 'robbery', 'holdap', 'theft', 'nakaw', 'emergency police'],
      response: `👮 **Crime & Security — Philippine National Police (PNP)**\n\n• **Emergency:** 911\n• **PNP Hotline:** 117\n• **QC Police District:** (02) 8928-4714\n\n**What to do:**\n1. Ensure your safety first\n2. Call 911 or 117\n3. Do NOT confront suspects\n4. Note descriptions (clothing, vehicle, direction)\n5. Preserve evidence\n\nReport via this system with photos if safe to do so.`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },
    {
      id: 'disaster-hotline',
      patterns: ['disaster', 'calamity', 'typhoon', 'bagyo', 'flood', 'baha', 'earthquake', 'lindol', 'ndrrmc'],
      response: `🌊 **Disaster & Calamity**\n\n• **NDRRMC:** 911 or (02) 8911-1406\n• **QC DRRMO:** (02) 8928-4396\n• **PAGASA:** (02) 8284-0800\n\n**For flood/typhoon:**\n1. Move to higher ground\n2. Turn off electricity\n3. Avoid floodwater (may be contaminated)\n4. Bring emergency kit\n5. Report via system for rescue coordination\n\n📻 Listen to PAGASA advisories during typhoons.`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },

    // ─── HOW TO REPORT ───
    {
      id: 'how-to-report',
      patterns: ['how to report', 'report emergency', 'paano mag report', 'submit report', 'file report', 'report incident', 'paano i-report', 'make report'],
      response: `📱 **How to Report an Emergency**\n\n**Step 1:** Click **Report Emergency** or log in first\n\n**Step 2:** Fill in details:\n• Type of incident (Fire, Medical, Accident, Flood, Crime, Other)\n• Title and description\n• Location (search or tap the map)\n• Contact number\n\n**Step 3:** Attach photos/videos (optional, max 5 files, 10MB each)\n\n**Step 4:** Click **Analyze with AI** for automatic priority detection\n\n**Step 5:** Submit — responders get alert INSTANTLY\n\n**Note:** Reports only work within Barangay Culiat (Tandang Sora Ave, Quezon Ave, Congressional Ave Ext).`,
      quickReplies: ['Report is not sending', 'AI analysis', 'Emergency hotlines']
    },
    {
      id: 'report-not-sending',
      patterns: ['report not sending', 'cannot submit', 'error reporting', 'report failed', 'submission error', 'ayaw mag submit', 'hindi ma submit'],
      response: `🔧 **Troubleshooting Report Issues**\n\n**Common causes:**\n• ❌ Not logged in → Log in first\n• ❌ Location outside Barangay Culiat → Check the map\n• ❌ Missing required fields → Fill in all * fields\n• ❌ Internet connection → Check your network\n• ❌ File too large → Max 10MB per file\n\n**Try this:**\n1. Refresh the page\n2. Log out and log back in\n3. Clear browser cache\n4. Try a different browser\n\nStill having issues? Call **0962-582-1531** for direct assistance.`,
      quickReplies: ['How to report', 'Login help']
    },
    {
      id: 'report-anonymous',
      patterns: ['anonymous', 'without account', 'no account', 'walang account', 'anonymous report', 'walang pangalan'],
      response: `🕵️ **Anonymous Reporting**\n\nUnfortunately, **anonymous reporting is not supported** in the current system. This is for:\n\n• ✅ Verification of legitimate emergencies\n• ✅ Preventing false alarms\n• ✅ Follow-up communication\n• ✅ Accountability\n\n**However**, your personal info is:\n• 🔒 Encrypted\n• 🔒 Only visible to verified responders\n• 🔒 Never shared publicly\n• 🔒 Protected under Data Privacy Act\n\nIf you witness an emergency, call **911** directly for anonymous reporting.`,
      quickReplies: ['Login help', 'Emergency hotlines']
    },

    // ─── AI ANALYSIS ───
    {
      id: 'ai-analysis',
      patterns: ['ai analysis', 'artificial intelligence', 'how ai works', 'gemini', 'ai detect', 'paano gumagana ai', 'automatic priority'],
      response: `🤖 **AI-Powered Analysis**\n\nWhen you submit a report, our AI automatically:\n\n**1. Detects Incident Type**\nAnalyzes text in English, Tagalog, or Taglish to identify: fire, medical, accident, flood, crime, or other\n\n**2. Assesses Priority**\n• 🔴 **Critical** — Life-threatening (explosion, shooting, unconscious)\n• 🟠 **High** — Serious (major accident, flooding, robbery)\n• 🟡 **Medium** — Needs attention (minor medical, disturbance)\n• 🔵 **Low** — Non-urgent or unclear\n\n**3. Suggests Actions**\nResponse recommendations for responders\n\n**4. Provides Confidence Score**\nHow sure the AI is (0-100%)\n\nThe AI understands **Taglish** too! (e.g., "may sunog sa kanto")`,
      quickReplies: ['How to report', 'AI accuracy']
    },
    {
      id: 'ai-accuracy',
      patterns: ['ai accuracy', 'ai correct', 'ai wrong', 'ai mistake', 'mali ai', 'reliable ai', 'is ai trustworthy'],
      response: `🎯 **AI Accuracy & Reliability**\n\nThe AI is a **decision-support tool**, not a replacement for human judgment:\n\n**Strengths:**\n• ✅ Understands English, Tagalog, Taglish\n• ✅ Handles thousands of emergency keywords\n• ✅ Detects nonsense/spam reports\n• ✅ Provides confidence scores\n\n**Limitations:**\n• ⚠️ Can be wrong with vague descriptions\n• ⚠️ Requires context clues\n• ⚠️ Responders always verify\n\n**Tip:** Be specific! Instead of "may problema," try "may sunog sa 3rd floor, may tao sa loob."\n\nEvery AI result is reviewed by actual responders before dispatch.`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },

    // ─── BARANGAY INFO ───
    {
      id: 'barangay-location',
      patterns: ['where is culiat', 'barangay location', 'saan ang culiat', 'location culiat', 'address', 'saan matatagpuan', 'tandang sora', 'congressional', 'quezon ave'],
      response: `🗺️ **Barangay Culiat Location**\n\nBarangay Culiat is located in **Quezon City, Metro Manila**.\n\n**Coverage Area:**\n• Tandang Sora Ave\n• Quezon Ave\n• Congressional Ave Ext\n\n**Reporting is LIMITED to these areas only.** Reports outside this scope will be rejected to ensure proper response coordination.\n\n**Nearby Landmarks:**\n• Tandang Sora Flyover\n• Congressional Ave\n• Visayas Ave (nearby)\n\n📍 All reports must have a location within the barangay for responders to reach you.`,
      quickReplies: ['How to report', 'Emergency hotlines']
    },
    {
      id: 'barangay-services',
      patterns: ['barangay services', 'what services', 'serbisyo', 'ano serbisyo', 'offices', 'barangay hall'],
      response: `🏛️ **Barangay Culiat Services**\n\n**Emergency Services:**\n• 24/7 incident reporting\n• Real-time responder dispatch\n• AI-assisted incident triage\n\n**Community Services:**\n• Barangay clearance\n• Certificate of residency\n• Business permits\n• Blotter reports\n• Mediation\n\n**Contact Barangay Hall:**\n• 📱 0962-582-1531\n• ☎️ 856-722-60\n• ✉️ brgy.culiat@yahoo.com\n\n**Office Hours:** Mon-Fri, 8AM-5PM (emergency line is 24/7)`,
      quickReplies: ['Emergency hotlines', 'Barangay officials']
    },

    // ─── ACCOUNT & LOGIN ───
    {
      id: 'login-help',
      patterns: ['login help', 'cannot login', 'forgot password', 'password reset', 'login failed', 'hindi maka login', 'nakalimutan password', 'account locked', 'locked out'],
      response: `🔐 **Login & Account Help**\n\n**Forgot Password?**\n1. Click **Login** → **Forgot Password?**\n2. Enter your registered email\n3. Check your inbox (and spam) for the reset link\n\n**Account Locked?**\nAfter 5 failed attempts, your account locks for 5 minutes. Wait or reset password.\n\n**Can't Log In?**\n• ✅ Use the exact email you registered\n• ✅ Passwords are case-sensitive\n• ✅ Clear browser cache if issues persist\n• ✅ Try a different browser\n\n**Admin/Responder accounts** must use the dedicated portal — not the resident login.`,
      quickReplies: ['Register account', 'OTP verification']
    },
    {
      id: 'register-account',
      patterns: ['register', 'create account', 'sign up', 'signup', 'paano mag register', 'gumawa account', 'new account'],
      response: `📝 **How to Register**\n\n**Step 1:** Click **Register** button\n\n**Step 2:** Fill in:\n• Full name\n• Email address\n• Strong password (8+ chars with uppercase, number, symbol)\n• Barangay: **Culiat**\n• PH mobile number (e.g., 09123456789)\n\n**Step 3:** Agree to Terms & Privacy Policy\n\n**Step 4:** Click **Create Secure Account**\n\n**Step 5:** Check your email to **confirm your account**\n\n✅ Once confirmed, you can log in and report incidents!`,
      quickReplies: ['Login help', 'OTP verification']
    },
    {
      id: 'otp-verification',
      patterns: ['otp', 'verification code', '2fa', 'two factor', 'code not received', 'hindi dumating code', 'otp code'],
      response: `🔢 **OTP (One-Time Password) Verification**\n\nAfter entering your password, we send a **6-digit code** to your email for security.\n\n**Code not received?**\n1. Check your **spam/junk** folder\n2. Wait 1-2 minutes (delays possible)\n3. Click **Resend Code** (60s cooldown)\n4. Verify email address is correct\n5. Check email storage isn't full\n\n**Code expired?**\nCodes expire after **10 minutes**. Request a new one.\n\n**Never share your OTP** with anyone — even if they claim to be from Barangay Culiat.`,
      quickReplies: ['Login help', 'Register account']
    },

    // ─── SYSTEM FEATURES ───
    {
      id: 'system-features',
      patterns: ['features', 'what can system do', 'system features', 'ano kaya ng system', 'capabilities system', 'functions'],
      response: `⚙️ **System Features**\n\n**🚨 For Residents:**\n• Real-time incident reporting\n• AI-powered priority detection\n• Photo/video attachments\n• Interactive map with location\n• Live barangay incident map\n• Status tracking (Reported → Resolved)\n\n**👮 For Responders:**\n• Instant siren alerts\n• Realtime emergency popup\n• Incident management dashboard\n• Analytics with charts\n• Bulk alerts to residents\n\n**🔒 Security:**\n• 256-bit encryption\n• OTP verification\n• Role-based access\n• Failed-login lockout`,
      quickReplies: ['AI analysis', 'How to report', 'Analytics']
    },
    {
      id: 'analytics',
      patterns: ['analytics', 'charts', 'statistics', 'stats', 'data', 'trends', 'reports analytics', 'graphs'],
      response: `📊 **Analytics Dashboard**\n\nAvailable for responders/admins:\n\n**Charts included:**\n• 📈 Incident trend over time (7D/30D/90D/1Y)\n• 🥧 Incidents by type (Fire, Medical, etc.)\n• 📊 Incidents by priority\n• 🔵 Status distribution\n• ⏰ Hourly incident pattern\n\n**KPIs tracked:**\n• Total incidents\n• Critical count\n• Resolution rate\n• Average response time\n\nAll charts update in **real-time** — no refresh needed.`,
      quickReplies: ['System features', 'AI analysis']
    },
    {
      id: 'realtime',
      patterns: ['realtime', 'real-time', 'live updates', 'instant', 'notification', 'siren', 'alert sound', 'paano mabilis'],
      response: `⚡ **Real-Time Updates**\n\n**For Residents:**\n• New incidents in your barangay appear instantly\n• Your reports show status changes live\n• Live map with incident markers\n\n**For Responders:**\n• 🚨 **Siren sound** plays IMMEDIATELY on new report\n• Popup shows full incident details\n• Dashboard auto-refreshes\n• No page reload needed\n\n**Technology:**\nWe use Supabase Realtime (WebSocket) + a 3-second polling fallback to ensure you NEVER miss an emergency.`,
      quickReplies: ['System features', 'Emergency hotlines']
    },

    // ─── WHAT TO DO IN EMERGENCIES ───
    {
      id: 'what-to-do-fire',
      patterns: ['what to do fire', 'fire emergency', 'sunog ano gagawin', 'fire safety', 'fire protocol'],
      response: `🔥 **In Case of Fire**\n\n**Immediate actions:**\n1. **Stay calm** — panic causes mistakes\n2. **Alert others** — shout "SUNOG!" / "FIRE!"\n3. **Evacuate immediately** — every second counts\n4. **Use stairs, NEVER elevators**\n5. **Crawl low** if smoke is thick\n6. **Feel doors** before opening — hot means fire behind\n7. **Once out, STAY OUT**\n\n**Call:** 911 or BFP (02) 8426-0219\n\n**Report to system** with:\n• Exact location\n• Number of people trapped\n• Fire size (small/medium/large)\n• Photos if safe\n\n⚠️ Do NOT fight large fires yourself.`,
      quickReplies: ['Emergency hotlines', 'How to report']
    },
    {
      id: 'what-to-do-medical',
      patterns: ['what to do medical', 'medical emergency', 'first aid', 'cpr', 'unconscious', 'hindi humihinga', 'atake', 'emergency medical'],
      response: `🚑 **Medical Emergency**\n\n**Immediate steps:**\n1. **Call 911** immediately\n2. Check responsiveness: tap and shout\n3. Check breathing (look, listen, feel for 10s)\n4. If not breathing → **CPR** (if trained)\n5. Do NOT move injured person unless in danger\n6. Keep them warm and calm\n7. Loosen tight clothing\n\n**For specific cases:**\n• 🫀 **Heart attack:** Sit upright, chew aspirin if not allergic\n• 🩸 **Severe bleeding:** Apply firm pressure with clean cloth\n• 🔥 **Burns:** Cool water 10-20 min, cover loosely\n• 🤕 **Head injury:** Keep still, monitor consciousness\n\n**Report via system** for fastest dispatch.`,
      quickReplies: ['Emergency hotlines', 'How to report']
    },

    // ─── FAQ / GENERAL ───
    {
      id: 'system-free',
      patterns: ['is it free', 'libre ba', 'cost', 'bayad', 'how much', 'presyo'],
      response: `✅ **100% FREE**\n\nThe Barangay Culiat Emergency Communication System is **completely free** for all residents.\n\n• No registration fees\n• No hidden charges\n• No subscription\n\nThis is a **public service** of Barangay Culiat. Your safety is our priority.`,
      quickReplies: ['How to report', 'Register account']
    },
    {
      id: 'privacy',
      patterns: ['privacy', 'data safe', 'is my data', 'security', 'personal info', 'data privacy'],
      response: `🔒 **Privacy & Data Security**\n\n**Your data is protected by:**\n• 256-bit encryption\n• Secure Supabase backend\n• Role-based access control\n• Data Privacy Act compliance\n\n**Who can see your info?**\n• ✅ Verified responders only\n• ✅ System admins (for maintenance)\n\n**What we DON'T do:**\n• ❌ Never share with third parties\n• ❌ Never sell your data\n• ❌ Never use for marketing\n\n**Your rights:**\n• Right to access your data\n• Right to correction\n• Right to deletion\n\nContact: brgy.culiat@yahoo.com`,
      quickReplies: ['System features', 'Login help']
    },
    {
      id: 'false-report',
      patterns: ['false report', 'prank', 'fake report', 'consequences', 'penalty', 'false alarm', 'joke report'],
      response: `⚠️ **False Reports — Consequences**\n\n**Filing false emergency reports is SERIOUS:**\n\n**Legal consequences:**\n• 📜 Violation of Presidential Decree 1727\n• 💰 Fines up to ₱50,000\n• 🚔 Possible imprisonment\n• ⛔ Permanent account ban\n\n**System detects fakes:**\n• 🤖 AI flags nonsense text\n• 📊 Responders verify reports\n• 📝 Repeat offenders flagged\n\n**BUT** — if you're genuinely unsure:\n• ✅ Better safe than sorry\n• ✅ Let responders decide\n• ✅ No penalty for genuine errors\n\n**In doubt? Call 911 directly.**`,
      quickReplies: ['AI analysis', 'Emergency hotlines']
    },
    {
      id: 'offline',
      patterns: ['offline', 'no internet', 'walang internet', 'down', 'system down', 'not working'],
      response: `🌐 **If the System is Down or No Internet**\n\n**Immediate action:**\n📞 **Call 911 directly** — don't wait\n\n**Barangay direct lines:**\n• 📱 0962-582-1531\n• ☎️ 856-722-60\n\n**Alternative methods:**\n• Go to Barangay Hall in person\n• Use a neighbor's phone\n• Public emergency call boxes\n\n**If you have internet but system not loading:**\n1. Refresh the page (Ctrl+F5)\n2. Clear browser cache\n3. Try a different browser\n4. Try mobile data instead of WiFi\n\n⚠️ For real emergencies, ALWAYS call 911 first.`,
      quickReplies: ['Emergency hotlines', 'How to report']
    },
    {
      id: 'age-limit',
      patterns: ['age limit', 'minimum age', 'can kids register', 'bata', 'senior', 'minor'],
      response: `👥 **Age & Eligibility**\n\n**Who can register:**\n• ✅ All residents of Barangay Culiat\n• ✅ All ages (with parental consent for minors)\n• ✅ Seniors are welcome\n• ✅ One account per person\n\n**Requirements:**\n• Valid email address\n• Active mobile number\n• Residence within Barangay Culiat\n\n**For minors:**\n• Parent/guardian should be informed\n• Use a family email or guardian's email recommended\n• Never share personal info with strangers online\n\n**Accessibility:** The system works on all devices — phones, tablets, computers.`,
      quickReplies: ['Register account', 'How to report']
    }
  ];

  // ============================================
  // WELCOME MESSAGE
  // ============================================
  const WELCOME = {
    response: `Hello! 👋 I'm **Culiat Assistant**, your AI helper.\n\nI can answer questions about:\n\n• 🚨 **Emergency hotlines**\n• 📱 **How to report incidents**\n• 🗺️ **Barangay information**\n• 🔒 **Account & login help**\n• 🤖 **How the AI system works**\n\nWhat would you like to know?`,
    quickReplies: ['Emergency hotlines', 'How to report', 'System features', 'Barangay info']
  };

  // ============================================
  // MATCHING ALGORITHM
  // ============================================
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\sáéíóúñàèìòùâêîôûäëïöü]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreMatch(normalizedQuery, pattern) {
    const q = normalizedQuery;
    const p = normalize(pattern);

    if (!q || !p) return 0;

    // Exact match
    if (q === p) return 1.0;

    // Word-boundary match
    const regex = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (regex.test(q)) return 0.9;

    // Substring match
    if (q.includes(p)) return 0.75;
    if (p.includes(q) && q.length >= 3) return 0.6;

    // Token overlap
    const qTokens = q.split(' ').filter(t => t.length > 2);
    const pTokens = p.split(' ').filter(t => t.length > 2);
    if (qTokens.length === 0 || pTokens.length === 0) return 0;

    let overlap = 0;
    qTokens.forEach(qt => {
      pTokens.forEach(pt => {
        if (qt === pt) overlap += 1;
        else if (qt.includes(pt) || pt.includes(qt)) overlap += 0.5;
      });
    });

    const score = overlap / Math.max(qTokens.length, pTokens.length);
    return score * 0.6;
  }

  function findBestMatch(query) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return null;

    let bestScore = 0;
    let bestEntry = null;

    KNOWLEDGE.forEach(entry => {
      entry.patterns.forEach(pattern => {
        const score = scoreMatch(normalizedQuery, pattern);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      });
    });

    // Only return if confidence is reasonable
    if (bestScore >= 0.4) {
      return { entry: bestEntry, score: bestScore };
    }
    return null;
  }

  // ============================================
  // FALLBACK RESPONSE
  // ============================================
  function getFallbackResponse(query) {
    return {
      response: `Hmm, I'm not sure about that. 🤔\n\nI'm specialized in helping with:\n\n• 🚨 Emergency hotlines & contacts\n• 📱 How to report incidents\n• 🗺️ Barangay Culiat information\n• 🔒 Account & login help\n• 🤖 System features & AI\n\n**Could you rephrase?** Or try one of the suggested topics below.\n\n**For real emergencies, call 911 immediately.**`,
      quickReplies: ['Emergency hotlines', 'How to report', 'System features', 'Login help']
    };
  }

  // ============================================
  // UI HELPERS
  // ============================================
  function getMessagesEl() { return document.getElementById('chatbotMessages'); }
  function getInputEl() { return document.getElementById('chatbotInput'); }
  function getSendBtn() { return document.getElementById('chatbotSend'); }

  function scrollToBottom() {
    const el = getMessagesEl();
    if (el) el.scrollTop = el.scrollHeight;
  }

  function formatMessage(text) {
    // Escape HTML first
    let safe = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Convert markdown-like syntax
    safe = safe
      // Bold
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Line breaks
      .replace(/\n/g, '<br>');

    // Bullets: lines starting with "• "
    safe = safe.replace(/(?:^|<br>)([•▪◦]) ([^<]+)/g, '$1 $2');

    return safe;
  }

  function addMessage(role, content) {
    const container = getMessagesEl();
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message ' + (role === 'user' ? 'user' : 'bot');

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    if (role === 'user') {
      avatar.innerHTML = '<i class="fas fa-user"></i>';
      if (window.lucide) {
        avatar.innerHTML = '<i data-lucide="user" style="width:14px;height:14px;"></i>';
      }
    } else {
      if (window.lucide) {
        avatar.innerHTML = '<i data-lucide="bot" style="width:14px;height:14px;"></i>';
      } else {
        avatar.innerHTML = '🤖';
      }
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = formatMessage(content);

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    container.appendChild(wrapper);

    if (window.lucide) window.lucide.createIcons();
    scrollToBottom();

    // Persist
    conversationHistory.push({ role, content, ts: Date.now() });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }
    saveHistory();
  }

  function addQuickReplies(replies) {
    if (!replies || replies.length === 0) return;
    const container = getMessagesEl();
    if (!container) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-quick-replies';

    replies.forEach(text => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-quick-reply';
      btn.textContent = text;
      btn.onclick = function () {
        // Remove quick replies
        wrap.remove();
        handleUserMessage(text);
      };
      wrap.appendChild(btn);
    });

    container.appendChild(wrap);
    scrollToBottom();
  }

  function showTyping() {
    const container = getMessagesEl();
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chat-typing';
    div.id = 'chatTypingIndicator';
    div.innerHTML = `
      <div class="chat-avatar"><i data-lucide="bot" style="width:14px;height:14px;"></i></div>
      <div class="chat-typing-bubble">
        <span class="chat-typing-dot"></span>
        <span class="chat-typing-dot"></span>
        <span class="chat-typing-dot"></span>
      </div>
    `;
    container.appendChild(div);
    if (window.lucide) window.lucide.createIcons();
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('chatTypingIndicator');
    if (el) el.remove();
  }

  // ============================================
  // PERSISTENCE
  // ============================================
  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
    } catch (e) {}
  }

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) conversationHistory = data.slice(-MAX_HISTORY);
    } catch (e) {}
  }

  // ============================================
  // MESSAGE HANDLER
  // ============================================
  function handleUserMessage(text) {
    if (!text || isTyping) return;

    // Remove existing quick reply buttons
    document.querySelectorAll('.chat-quick-replies').forEach(el => el.remove());

    addMessage('user', text);

    isTyping = true;
    const sendBtn = getSendBtn();
    if (sendBtn) sendBtn.disabled = true;

    // Simulate typing delay
    const delay = 400 + Math.random() * 500;
    setTimeout(() => {
      showTyping();

      setTimeout(() => {
        hideTyping();

        const match = findBestMatch(text);
        const reply = match ? match.entry : getFallbackResponse(text);

        // Add slight delay variance
        addMessage('bot', reply.response);
        if (reply.quickReplies && reply.quickReplies.length) {
          addQuickReplies(reply.quickReplies);
        }

        isTyping = false;
        if (sendBtn) sendBtn.disabled = false;
        scrollToBottom();
      }, 500 + Math.random() * 400);
    }, delay);
  }

  function sendChatMessage() {
    const input = getInputEl();
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    handleUserMessage(text);
  }

  // ============================================
  // PUBLIC API
  // ============================================
  function toggleChatbot() {
    const win = document.getElementById('chatbotWindow');
    const badge = document.getElementById('chatbotBadge');
    if (!win) return;

    chatbotOpen = !chatbotOpen;

    if (chatbotOpen) {
      win.classList.add('open');
      if (badge) badge.style.display = 'none';

      if (!hasWelcomed) {
        hasWelcomed = true;
        loadHistory();
        if (conversationHistory.length === 0) {
          setTimeout(() => {
            addMessage('bot', WELCOME.response);
            addQuickReplies(WELCOME.quickReplies);
          }, 300);
        } else {
          // Restore history
          const container = getMessagesEl();
          if (container) container.innerHTML = '';
          conversationHistory.forEach(msg => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chat-message ' + (msg.role === 'user' ? 'user' : 'bot');
            const avatar = document.createElement('div');
            avatar.className = 'chat-avatar';
            avatar.innerHTML = msg.role === 'user'
              ? '<i data-lucide="user" style="width:14px;height:14px;"></i>'
              : '<i data-lucide="bot" style="width:14px;height:14px;"></i>';
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            bubble.innerHTML = formatMessage(msg.content);
            wrapper.appendChild(avatar);
            wrapper.appendChild(bubble);
            container.appendChild(wrapper);
          });
          if (window.lucide) window.lucide.createIcons();
          scrollToBottom();
          addQuickReplies(WELCOME.quickReplies);
        }
      }

      setTimeout(() => {
        const input = getInputEl();
        if (input) input.focus();
      }, 300);
    } else {
      win.classList.remove('open');
    }
  }

  function openChatbot() {
    if (!chatbotOpen) toggleChatbot();
  }

  function closeChatbot() {
    if (chatbotOpen) toggleChatbot();
  }

  function clearChat() {
    if (!confirm('Clear the entire conversation?')) return;
    conversationHistory = [];
    sessionStorage.removeItem(STORAGE_KEY);
    const container = getMessagesEl();
    if (container) container.innerHTML = '';
    hasWelcomed = false;
    // Re-show welcome
    hasWelcomed = true;
    addMessage('bot', WELCOME.response);
    addQuickReplies(WELCOME.quickReplies);
  }

  // ============================================
  // INPUT HANDLERS
  // ============================================
  function bindInput() {
    const input = getInputEl();
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';

    // Auto-resize
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // Enter to send, Shift+Enter for newline
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // ============================================
  // INIT
  // ============================================
  document.addEventListener('DOMContentLoaded', function () {
    bindInput();

    // Close on outside click
    document.addEventListener('click', function (e) {
      const win = document.getElementById('chatbotWindow');
      const toggle = document.getElementById('chatbotToggle');
      if (!win || !toggle) return;
      if (chatbotOpen && !win.contains(e.target) && !toggle.contains(e.target)) {
        // Don't auto-close on mobile-like experiences... keep open
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && chatbotOpen) closeChatbot();
    });
  });

  // ============================================
  // EXPOSE GLOBALLY
  // ============================================
  window.toggleChatbot = toggleChatbot;
  window.openChatbot = openChatbot;
  window.closeChatbot = closeChatbot;
  window.clearChat = clearChat;
  window.sendChatMessage = sendChatMessage;
  window.handleUserMessage = handleUserMessage;

  window.CuliatChatbot = {
    toggle: toggleChatbot,
    open: openChatbot,
    close: closeChatbot,
    clear: clearChat,
    send: handleUserMessage,
    findBestMatch,
    KNOWLEDGE
  };

  console.log('💬 Culiat Chatbot loaded · ' + KNOWLEDGE.length + ' knowledge entries');
})();