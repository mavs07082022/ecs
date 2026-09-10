// supabase/functions/send-sms-textbee/test.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testTextBee() {
  console.log('🧪 Testing TextBee SMS Gateway...');
  console.log('=====================================');

  // Check if environment variables are set
  const textbeeKey = Deno.env.get('TEXTBEE_API_KEY');
  const textbeeDevice = Deno.env.get('TEXTBEE_DEVICE_ID');

  if (!textbeeKey || !textbeeDevice) {
    console.error('❌ Missing environment variables:');
    console.error('   TEXTBEE_API_KEY:', textbeeKey ? '✅ Set' : '❌ Missing');
    console.error('   TEXTBEE_DEVICE_ID:', textbeeDevice ? '✅ Set' : '❌ Missing');
    console.log('\n📝 Set them using:');
    console.log('   supabase secrets set TEXTBEE_API_KEY=your_api_key');
    console.log('   supabase secrets set TEXTBEE_DEVICE_ID=your_device_id');
    return;
  }

  console.log('✅ Environment variables found');

  try {
    // Get the phone number to test with
    const phone = prompt('Enter phone number to test (e.g., +639171234567):');
    if (!phone) {
      console.log('❌ No phone number provided');
      return;
    }

    console.log(`📱 Testing with phone: ${phone}`);

    // Call the edge function with test mode
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-sms-textbee`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          test_mode: true,
          test_phone: phone
        })
      }
    );

    const result = await response.json();
    console.log('📱 SMS Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ SMS test successful!');
      if (result.details) {
        console.log(`📊 Sent: ${result.sent_count}/${result.total_recipients}`);
        result.details.forEach(d => {
          console.log(`   ${d.recipient}: ${d.status}${d.error ? ' (' + d.error + ')' : ''}`);
        });
      }
    } else {
      console.error('❌ SMS test failed:', result.error);
    }

    // Check SMS logs
    console.log('\n📋 Checking SMS logs...');
    const { data: logs, error: logsError } = await supabase
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (logsError) {
      console.error('❌ Failed to fetch logs:', logsError);
      return;
    }

    if (logs && logs.length > 0) {
      console.log(`📊 Latest ${logs.length} SMS logs:`);
      logs.forEach(log => {
        console.log(`   ${log.recipient_name || 'Unknown'} (${log.recipient_phone}): ${log.status} - ${new Date(log.created_at).toLocaleString()}`);
      });
    } else {
      console.log('   No SMS logs found');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

// Run the test
testTextBee();