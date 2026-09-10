// supabase/functions/send-sms-textbee/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Configuration
const TEXTBEE_API_KEY = Deno.env.get('txb_usojo96bfYrwPTNoIrbxRsticGSVucXf') || '';
const TEXTBEE_DEVICE_ID = Deno.env.get('6a81e94c3005599046cb7e10') || '';
const TEXTBEE_API_URL = 'https://api.textbee.dev/api/v1/gateway/devices';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// SMS Settings
const SMS_INTERVAL = 2000;
const MAX_MESSAGE_LENGTH = 1600;0

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ============================================
// MAIN HANDLER
// ============================================
serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  try {
    const body = await req.json();
    const incident_id = body.incident_id;
    const test_mode = body.test_mode || false;
    const test_phone = body.test_phone || '';

    console.log(`📱 Processing SMS via TextBee.dev for incident: ${incident_id}`);

    // Validate configuration
    if (!TEXTBEE_API_KEY || !TEXTBEE_DEVICE_ID) {
      console.error('❌ TextBee not configured');
      return new Response(JSON.stringify({
        success: false,
        error: 'TextBee API not configured. Please set TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID.'
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Fetch incident details
    const { data: incident, error: incidentError } = await supabaseAdmin
      .from('incident_reports')
      .select(`
        *,
        profiles:reporter_id (
          full_name,
          contact_number,
          barangay
        )
      `)
      .eq('id', incident_id)
      .single();

    if (incidentError || !incident) {
      console.error('❌ Incident not found:', incidentError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Incident not found'
      }), {
        status: 404,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Determine recipients
    let residents: any[] = [];
    
    if (test_mode && test_phone) {
      // Test mode with specific phone
      residents = [{
        id: 'test_user',
        full_name: 'Test User',
        contact_number: test_phone,
        sms_enabled: true
      }];
      console.log(`🧪 Test mode: Sending to ${test_phone}`);
    } else if (test_mode) {
      // Test mode - send only to reporter
      const reporterName = incident.profiles?.full_name || 'Reporter';
      const reporterPhone = incident.contact_number || incident.profiles?.contact_number || '';
      residents = [{
        id: incident.reporter_id,
        full_name: reporterName,
        contact_number: reporterPhone,
        sms_enabled: true
      }];
      console.log(`🧪 Test mode: Sending only to reporter: ${residents[0]?.full_name}`);
    } else {
      // Production - send to all residents with SMS enabled
      const { data: allResidents, error: residentsError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, contact_number, sms_enabled')
        .eq('role', 'resident')
        .eq('sms_enabled', true)
        .not('contact_number', 'is', null)
        .neq('contact_number', '');

      if (residentsError) {
        console.error('❌ Error fetching residents:', residentsError);
        throw new Error('Failed to fetch residents');
      }

      residents = allResidents || [];
    }

    if (!residents || residents.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No residents to notify',
        recipient_count: 0
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    console.log(`📱 Found ${residents.length} residents to notify`);

    // Build SMS messages
    const messages: any[] = [];
    for (const resident of residents) {
      const phone = formatPhoneNumber(resident.contact_number);
      if (!phone) {
        console.log(`⚠️ Invalid phone for ${resident.full_name}: ${resident.contact_number}`);
        continue;
      }
      messages.push({
        phone: phone,
        name: resident.full_name || 'Resident',
        message: buildSmsMessage(incident, resident.full_name)
      });
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid phone numbers found',
        recipient_count: 0
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Send SMS with rate limiting
    const results: any[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const phone = msg.phone;
      const name = msg.name;
      const message = msg.message;
      
      try {
        console.log(`📤 Sending SMS to ${name} (${phone}) [${i + 1}/${messages.length}]`);
        
        const result = await sendSmsTextBee(phone, message);
        
        // Log to database
        await logSmsToDatabase(incident_id, phone, name, message, result);

        if (result.success) {
          sentCount++;
          results.push({ recipient: name, phone, status: 'sent' });
          console.log(`✅ SMS sent to ${name}`);
        } else {
          failedCount++;
          results.push({ recipient: name, phone, status: 'failed', error: result.error });
          console.log(`❌ SMS failed for ${name}: ${result.error}`);
        }

        // Rate limiting - wait before next message
        if (i < messages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, SMS_INTERVAL));
        }

      } catch (error: any) {
        console.error(`❌ Error sending to ${name}:`, error);
        failedCount++;
        results.push({
          recipient: name,
          phone: phone,
          status: 'failed',
          error: error.message || 'Unknown error'
        });
      }
    }

    console.log(`✅ SMS sending complete. Sent: ${sentCount}, Failed: ${failedCount}`);

    return new Response(JSON.stringify({
      success: true,
      total_recipients: messages.length,
      sent_count: sentCount,
      failed_count: failedCount,
      details: results,
      test_mode: test_mode || false
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error: any) {
    console.error('❌ Error in send-sms function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Unknown error'
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function buildSmsMessage(incident: any, recipientName: string): string {
  const incidentType = incident.type.charAt(0).toUpperCase() + incident.type.slice(1);
  const priorityEmojis: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  };
  const priorityEmoji = priorityEmojis[incident.priority] || '🟡';

  // Parse location
  let locationText = incident.location;
  try {
    const locObj = JSON.parse(incident.location);
    if (locObj.address) locationText = locObj.address;
    else if (locObj.latitude && locObj.longitude) {
      locationText = `${locObj.latitude}, ${locObj.longitude}`;
    }
  } catch (e) {
    // Location is already a string
  }

  // Get safety advice
  const safetyAdvice = getSafetyAdvice(incident.type, incident.priority);

  // Check for media
  let mediaInfo = '';
  if (incident.media_urls) {
    try {
      const mediaUrls = typeof incident.media_urls === 'string' 
        ? JSON.parse(incident.media_urls) 
        : incident.media_urls;
      if (mediaUrls && mediaUrls.length > 0) {
        mediaInfo = `📎 ${mediaUrls.length} photo(s)/video(s) attached. Check the app for details.`;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // Build message
  const messageParts = [
    `🚨 BARANGAY CULIAT EMERGENCY ALERT`,
    ``,
    `Dear Resident,`,
    ``,
    `${priorityEmoji} ${incidentType.toUpperCase()} INCIDENT`,
    `📍 Location: ${locationText}`,
    `📋 ${incident.title}`,
    `📝 ${incident.description.substring(0, 120)}${incident.description.length > 120 ? '...' : ''}`,
    `⚠️ Priority: ${incident.priority.toUpperCase()}`,
    `📅 ${new Date(incident.created_at).toLocaleString()}`,
  ];

  if (mediaInfo) {
    messageParts.push(mediaInfo);
  }

  messageParts.push(
    ``,
    `🛡️ SAFETY: ${safetyAdvice}`,
    ``,
    `📞 Barangay Hall: (02) 1234-5678`,
    `🚨 DO NOT REPLY - Automated Alert`,
    ``,
    `---`,
    `Barangay Culiat Emergency System`
  );

  let message = messageParts.join('\n');

  // Truncate if too long
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH - 20) + '... [truncated]';
  }

  return message;
}

function getSafetyAdvice(type: string, priority: string): string {
  const adviceMap: Record<string, string> = {
    fire: 'Evacuate immediately. Call 911. Stay low to avoid smoke. Meet at evacuation area.',
    medical: 'Call 911. Do not move the person. Provide first aid if trained. Keep calm.',
    accident: 'Call 911. Do not move injured. Turn on hazard lights. Stay safe from traffic.',
    flood: 'Move to higher ground. Turn off electricity. Do not drive through flood waters.',
    crime: 'Ensure safety first. Call 911. Do not confront. Stay away from danger.',
    other: 'Stay calm. Follow instructions from authorities. Help others if safe.'
  };

  const baseAdvice = adviceMap[type] || 'Stay calm and follow instructions from authorities.';
  
  if (priority === 'critical') {
    return `⚠️ CRITICAL: ${baseAdvice}`;
  } else if (priority === 'high') {
    return `⚠️ URGENT: ${baseAdvice}`;
  }
  return baseAdvice;
}

function formatPhoneNumber(phone: string): string | null {
  if (!phone) return null;
  
  // Remove all non-numeric characters except +
  let cleaned = phone.replace(/[^0-9+]/g, '');
  
  // Format for Philippines
  if (cleaned.startsWith('0')) {
    cleaned = '+63' + cleaned.substring(1);
  } else if (cleaned.startsWith('63') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  } else if (cleaned.startsWith('9')) {
    cleaned = '+63' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  // Validate
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return null;
  }

  return cleaned;
}

async function sendSmsTextBee(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${TEXTBEE_API_URL}/${TEXTBEE_DEVICE_ID}/send-sms`;
    
    console.log(`📤 Sending to TextBee API: ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEXTBEE_API_KEY
      },
      body: JSON.stringify({
        recipients: [phone],
        message: message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.message || data.error || `HTTP ${response.status}`;
      console.error('❌ TextBee API error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    if (data.success === true || data.status === 'success' || data.sent === true) {
      console.log('✅ SMS sent via TextBee');
      return { success: true };
    }

    if (data.error || data.message) {
      return { success: false, error: data.error || data.message };
    }

    return { success: true };

  } catch (error: any) {
    console.error('❌ TextBee send error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

async function logSmsToDatabase(
  incident_id: string,
  phone: string,
  name: string,
  message: string,
  result: { success: boolean; error?: string }
) {
  try {
    await supabaseAdmin
      .from('sms_logs')
      .insert({
        incident_id: incident_id,
        recipient_phone: phone,
        recipient_name: name,
        message: message.substring(0, 500),
        status: result.success ? 'sent' : 'failed',
        provider: 'textbee',
        provider_response: result.error ? { error: result.error } : null,
        sent_at: new Date().toISOString()
      });
  } catch (error: any) {
    console.error('❌ Logging error:', error);
  }
}