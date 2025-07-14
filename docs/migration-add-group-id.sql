-- Migration: Add group_id column to user_group_preferences table
-- Run this SQL in your Supabase SQL Editor to update the existing table

-- Step 1: Add the new group_id column
ALTER TABLE public.user_group_preferences 
ADD COLUMN IF NOT EXISTS group_id text;

-- Step 2: Update the unique constraint to use group_id instead of group_name
-- First drop the old constraint
ALTER TABLE public.user_group_preferences 
DROP CONSTRAINT IF EXISTS user_group_preferences_user_group_unique;

-- Then add the new constraint (after populating group_id values)
-- ALTER TABLE public.user_group_preferences 
-- ADD CONSTRAINT user_group_preferences_user_group_unique UNIQUE (user_id, group_id);

-- Note: 
-- 1. You'll need to populate the group_id column with actual WhatsApp group JIDs
-- 2. Then make the group_id column NOT NULL
-- 3. Finally add the unique constraint
-- 
-- Example update (replace with actual group IDs):
-- UPDATE public.user_group_preferences 
-- SET group_id = '120363401437046636@g.us' 
-- WHERE group_name = 'Real Estate Connect';
--
-- UPDATE public.user_group_preferences 
-- SET group_id = '123456789012345678@g.us' 
-- WHERE group_name = 'test';

-- Step 3: After populating group_id values, make it NOT NULL
-- ALTER TABLE public.user_group_preferences 
-- ALTER COLUMN group_id SET NOT NULL;

-- Step 4: Add the unique constraint
-- ALTER TABLE public.user_group_preferences 
-- ADD CONSTRAINT user_group_preferences_user_group_unique UNIQUE (user_id, group_id);

-- Step 5: Add index for performance
CREATE INDEX IF NOT EXISTS idx_user_group_preferences_group_id 
ON public.user_group_preferences(group_id);
