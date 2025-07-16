-- Migration: Add processed column to whatsapp_messages table
-- Run this SQL in your Supabase SQL Editor

-- Add processed column to track which messages have been parsed
ALTER TABLE public.whatsapp_messages 
ADD COLUMN IF NOT EXISTS processed boolean DEFAULT false;

-- Create index for efficient querying of unprocessed messages
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_processed ON public.whatsapp_messages(processed);

-- Create composite index for querying unprocessed messages by timestamp
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unprocessed_timestamp ON public.whatsapp_messages(processed, timestamp) WHERE processed = false;
