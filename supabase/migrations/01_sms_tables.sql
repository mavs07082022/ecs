-- supabase/migrations/01_sms_tables.sql

-- Add SMS preference to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT true;

-- Create SMS logs table
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  incident_id UUID REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider TEXT DEFAULT 'textbee',
  provider_response JSONB,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sms_logs_incident_id ON public.sms_logs(incident_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON public.sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs(created_at DESC);

-- Function to trigger SMS on incident insert
CREATE OR REPLACE FUNCTION public.trigger_sms_on_incident()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM
    net.http_post(
      url := 'https://' || current_setting('supabase_domain') || '/functions/v1/send-sms-textbee',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('incident_id', NEW.id)
    );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'SMS trigger error: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_sms_on_incident_insert ON public.incident_reports;
CREATE TRIGGER trigger_sms_on_incident_insert
  AFTER INSERT ON public.incident_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sms_on_incident();

-- Function to manually test SMS
CREATE OR REPLACE FUNCTION public.test_sms(incident_id UUID)
RETURNS JSONB AS $$
DECLARE
  response_json JSONB;
BEGIN
  SELECT net.http_post(
    url := 'https://' || current_setting('supabase_domain') || '/functions/v1/send-sms-textbee',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object(
      'incident_id', incident_id,
      'test_mode', true
    )
  ) INTO response_json;
  RETURN response_json;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql;