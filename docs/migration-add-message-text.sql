-- Migration: Add message_text column and rename message to message_meta
-- Run this SQL in your Supabase SQL Editor to update the existing table

-- Step 1: Add the new message_text column
ALTER TABLE public.whatsapp_messages 
ADD COLUMN IF NOT EXISTS message_text text;

-- Step 2: Rename message column to message_meta
ALTER TABLE public.whatsapp_messages 
RENAME COLUMN message TO message_meta;

-- Step 3: Extract text from existing message_meta and populate message_text
-- This handles the most common WhatsApp message types
UPDATE public.whatsapp_messages 
SET message_text = CASE
    -- Simple conversation messages
    WHEN message_meta->>'conversation' IS NOT NULL 
    THEN message_meta->>'conversation'
    
    -- Extended text messages
    WHEN message_meta->'extendedTextMessage'->>'text' IS NOT NULL 
    THEN message_meta->'extendedTextMessage'->>'text'
    
    -- Image messages with captions
    WHEN message_meta->'imageMessage'->>'caption' IS NOT NULL 
    THEN CONCAT('[Image] ', message_meta->'imageMessage'->>'caption')
    
    -- Video messages with captions
    WHEN message_meta->'videoMessage'->>'caption' IS NOT NULL 
    THEN CONCAT('[Video] ', message_meta->'videoMessage'->>'caption')
    
    -- Document messages
    WHEN message_meta->'documentMessage'->>'fileName' IS NOT NULL 
    THEN CONCAT('[Document] ', message_meta->'documentMessage'->>'fileName')
    
    -- Audio messages
    WHEN message_meta->>'audioMessage' IS NOT NULL 
    THEN '[Audio Message]'
    
    -- Image messages without captions
    WHEN message_meta->>'imageMessage' IS NOT NULL 
    THEN '[Image]'
    
    -- Video messages without captions
    WHEN message_meta->>'videoMessage' IS NOT NULL 
    THEN '[Video]'
    
    -- Contact messages
    WHEN message_meta->'contactMessage'->>'displayName' IS NOT NULL 
    THEN CONCAT('[Contact] ', message_meta->'contactMessage'->>'displayName')
    
    -- Location messages
    WHEN message_meta->>'locationMessage' IS NOT NULL 
    THEN '[Location]'
    
    -- Sticker messages
    WHEN message_meta->>'stickerMessage' IS NOT NULL 
    THEN '[Sticker]'
    
    -- Default fallback
    ELSE '[Unknown Message Type]'
END
WHERE message_text IS NULL;

-- Step 4: Add full-text search index
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_text_search 
ON public.whatsapp_messages USING gin(to_tsvector('english', message_text));

-- Step 5: Add regular text search index
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_message_text 
ON public.whatsapp_messages(message_text);

-- Optional: Show sample of updated data
-- SELECT id, group_name, sender, message_text, 
--        LEFT(message_meta::text, 100) as message_meta_preview
-- FROM public.whatsapp_messages 
-- LIMIT 10;
