-- WhatsApp Real Estate Bot Database Setup
-- Run this SQL in your Supabase SQL Editor to create the required tables and policies

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables if they exist (in correct order due to foreign key constraints)
DROP TABLE IF EXISTS public.user_group_preferences CASCADE;
DROP TABLE IF EXISTS public.whatsapp_keys CASCADE;
DROP TABLE IF EXISTS public.whatsapp_auth CASCADE;
DROP TABLE IF EXISTS public.whatsapp_messages CASCADE;

-- Create whatsapp_messages table
CREATE TABLE public.whatsapp_messages (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    timestamp timestamp with time zone NOT NULL,
    group_id text NOT NULL,
    group_name text NOT NULL,
    sender text NOT NULL,
    message_text text,
    message_meta jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id)
    -- Note: No foreign key constraint to allow system UUID
);

-- Create whatsapp_auth table
CREATE TABLE public.whatsapp_auth (
    user_id uuid NOT NULL,
    creds jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT whatsapp_auth_pkey PRIMARY KEY (user_id),
    CONSTRAINT whatsapp_auth_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create whatsapp_keys table
CREATE TABLE public.whatsapp_keys (
    user_id uuid NOT NULL,
    key_type text NOT NULL,
    key_id text NOT NULL,
    key_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT whatsapp_keys_pkey PRIMARY KEY (user_id, key_type, key_id),
    CONSTRAINT whatsapp_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create user_group_preferences table (optional - for future filtering)
CREATE TABLE public.user_group_preferences (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    group_id text NOT NULL,
    group_name text NOT NULL,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_group_preferences_pkey PRIMARY KEY (id),
    CONSTRAINT user_group_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT user_group_preferences_user_group_unique UNIQUE (user_id, group_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_id ON public.whatsapp_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_group_id ON public.whatsapp_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_group_name ON public.whatsapp_messages(group_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON public.whatsapp_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_group_timestamp ON public.whatsapp_messages(user_id, group_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_keys_user_type ON public.whatsapp_keys(user_id, key_type);

-- Full-text search index for message content
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_text_search ON public.whatsapp_messages USING gin(to_tsvector('english', message_text));

-- Enable Row Level Security (RLS)
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_group_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read all messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "System can insert messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Debug allow all inserts" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Allow anon system inserts" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Allow all system inserts" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Enable read for all" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Enable insert for system UUID" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Users can manage their own auth" ON public.whatsapp_auth;
DROP POLICY IF EXISTS "Users can manage their own keys" ON public.whatsapp_keys;
DROP POLICY IF EXISTS "Users can manage their own preferences" ON public.user_group_preferences;

-- RLS Policies for whatsapp_messages
-- Allow read access for both authenticated and anonymous users
CREATE POLICY "Enable read for all" ON public.whatsapp_messages
    FOR SELECT 
    USING (true);

-- Allow inserts for system UUID (works for both authenticated and anonymous connections)
CREATE POLICY "Enable insert for system UUID" ON public.whatsapp_messages
    FOR INSERT
    WITH CHECK (
        user_id = '00000000-0000-0000-0000-000000000000'::uuid
    );

-- Allow authenticated users to insert their own messages (for future use cases)
CREATE POLICY "Authenticated users can insert messages" ON public.whatsapp_messages
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND auth.uid() = user_id
    );

-- RLS Policies for whatsapp_auth
CREATE POLICY "Users can manage their own auth" ON public.whatsapp_auth
    FOR ALL 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS Policies for whatsapp_keys
CREATE POLICY "Users can manage their own keys" ON public.whatsapp_keys
    FOR ALL 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_group_preferences
CREATE POLICY "Users can manage their own preferences" ON public.user_group_preferences
    FOR ALL 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updating updated_at columns
DROP TRIGGER IF EXISTS update_whatsapp_auth_updated_at ON public.whatsapp_auth;
CREATE TRIGGER update_whatsapp_auth_updated_at
    BEFORE UPDATE ON public.whatsapp_auth
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_keys_updated_at ON public.whatsapp_keys;
CREATE TRIGGER update_whatsapp_keys_updated_at
    BEFORE UPDATE ON public.whatsapp_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_group_preferences_updated_at ON public.user_group_preferences;
CREATE TRIGGER update_user_group_preferences_updated_at
    BEFORE UPDATE ON public.user_group_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions
GRANT ALL ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_auth TO authenticated;
GRANT ALL ON public.whatsapp_keys TO authenticated;
GRANT ALL ON public.user_group_preferences TO authenticated;

-- Grant INSERT and SELECT permission to anon role for system messages
GRANT INSERT, SELECT ON public.whatsapp_messages TO anon;

-- Grant USAGE on sequences to anon (needed for auto-generated UUIDs)
GRANT USAGE ON SCHEMA public TO anon;

-- Insert a test system user record (optional - for reference)
-- This represents the system user that stores all messages
-- Note: We don't actually need this in auth.users since we removed the foreign key constraint
-- INSERT INTO auth.users (id, email, created_at, updated_at) 
-- VALUES (
--     '00000000-0000-0000-0000-000000000000'::uuid,
--     'system@whatsapp-bot.local',
--     now(),
--     now()
-- ) ON CONFLICT (id) DO NOTHING;

-- Verify table creation and structure
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN ('whatsapp_messages', 'whatsapp_auth', 'whatsapp_keys', 'user_group_preferences')
ORDER BY table_name, ordinal_position;

-- Verify RLS policies are working
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'whatsapp_messages';

-- Test connectivity and permissions (optional)
-- Uncomment the following to test system message insertion:
/*
INSERT INTO public.whatsapp_messages (
    user_id, 
    timestamp, 
    group_id, 
    group_name, 
    sender, 
    message
) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    NOW(),
    'test-setup@g.us',
    'setup-test',
    'setup-test@s.whatsapp.net',
    '{"conversation": "Database setup test message"}'::jsonb
);
*/
