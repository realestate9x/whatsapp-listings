# Supabase Setup Guide for WhatsApp Listings

## 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up/Sign in to your account
3. Click "New Project"
4. Choose your organization and create a new project
5. Wait for the project to be set up

## 2. Get Your Supabase Credentials

1. Go to Project Settings → API
2. Copy your Project URL
3. Copy your `anon` `public` key

## 3. Create Environment Variables File

Create a `.env` file in the `whatsapp-listings` directory with the following content:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

Replace the placeholder values with your actual Supabase credentials.

## 4. Create Database Table

In your Supabase dashboard, go to the SQL Editor and run this query to create the messages table:

```sql
-- Required extension for UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table to store raw WhatsApp messages
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  sender TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_content JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'unprocessed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);
CREATE INDEX idx_whatsapp_messages_group_id ON whatsapp_messages(group_id);
CREATE INDEX idx_whatsapp_messages_group_name ON whatsapp_messages(group_name);
CREATE INDEX idx_whatsapp_messages_status ON whatsapp_messages(status);ages_group_name ON whatsapp_messages(group_name);
```

## 5. Enable Row Level Security (Optional but Recommended)

If you want to add security policies:

```sql
-- Enable RLS
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users (adjust as needed)
CREATE POLICY "Enable read access for authenticated users" ON whatsapp_messages
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users" ON whatsapp_messages
FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

## 6. Test the Setup

1. Restart your application: `npm run dev`
2. Send a message in your "test" WhatsApp group
3. Check the console for success messages
4. Verify data in Supabase dashboard under Table Editor → whatsapp_messages

## Features Added

- ✅ Dual storage: Messages are saved to both log file AND Supabase database
- ✅ Structured data: Better querying and analysis capabilities
- ✅ Scalable: Database can handle large volumes of messages
- ✅ Real-time: Can build real-time features with Supabase subscriptions
- ✅ API ready: Easy to build REST APIs on top of stored data

## Next Steps

With Supabase set up, you can:
- Build a web dashboard to view messages
- Create APIs to search and filter messages
- Set up real-time notifications
- Export data for analysis
- Build a real estate listing management system 