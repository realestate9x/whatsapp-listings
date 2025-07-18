-- WhatsApp Auth State Tables for Supabase
-- Run these queries in your Supabase SQL editor

-- Table to store WhatsApp authentication credentials
CREATE TABLE whatsapp_auth_creds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    creds_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to store WhatsApp signal keys
CREATE TABLE whatsapp_auth_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_type TEXT NOT NULL, -- 'pre-key', 'session', 'sender-key', etc.
    key_id TEXT NOT NULL,
    key_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, key_type, key_id)
);

-- Add indexes for better performance
CREATE INDEX idx_whatsapp_auth_creds_user_id ON whatsapp_auth_creds(user_id);
CREATE INDEX idx_whatsapp_auth_keys_user_id ON whatsapp_auth_keys(user_id);
CREATE INDEX idx_whatsapp_auth_keys_type ON whatsapp_auth_keys(user_id, key_type);

-- Add updated_at trigger function (if not already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers to automatically update updated_at
CREATE TRIGGER update_whatsapp_auth_creds_updated_at 
    BEFORE UPDATE ON whatsapp_auth_creds 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_auth_keys_updated_at 
    BEFORE UPDATE ON whatsapp_auth_keys 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE whatsapp_auth_creds ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auth_keys ENABLE ROW LEVEL SECURITY;

-- Allow users to manage their own auth data
CREATE POLICY "Users can manage their own auth creds" ON whatsapp_auth_creds
    FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage their own auth keys" ON whatsapp_auth_keys
    FOR ALL USING (auth.uid()::text = user_id);

-- Allow service role to bypass RLS (for backend operations)
CREATE POLICY "Service role can manage all auth data" ON whatsapp_auth_creds
    FOR ALL TO service_role USING (true);

CREATE POLICY "Service role can manage all auth keys" ON whatsapp_auth_keys
    FOR ALL TO service_role USING (true);
