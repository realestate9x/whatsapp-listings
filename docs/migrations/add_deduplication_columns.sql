-- Migration: Add message deduplication columns
-- Description: Adds message_hash column to enable deduplication
-- Date: 2025-07-17

-- Add message_hash column for deduplication
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS message_hash TEXT;

-- Create index for message deduplication
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_hash ON whatsapp_messages(message_hash);

-- Create unique index to prevent duplicate hashes for the same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_user_hash 
ON whatsapp_messages(user_id, message_hash) 
WHERE message_hash IS NOT NULL;

-- Add comment to describe the new column
COMMENT ON COLUMN whatsapp_messages.message_hash IS 'SHA256 hash of normalized message text + sender for deduplication';
