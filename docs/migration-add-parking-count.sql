-- Migration to add parking_count field
-- Run this in Supabase SQL editor

-- Add parking_count field to parsed_real_estate_properties table
ALTER TABLE public.parsed_real_estate_properties 
ADD COLUMN parking_count integer DEFAULT NULL;

-- Update existing records: if parking = true, set parking_count = 1
UPDATE public.parsed_real_estate_properties 
SET parking_count = 1 
WHERE parking = true;

-- Create index for parking_count for better query performance
CREATE INDEX IF NOT EXISTS idx_parsed_properties_parking_count 
ON public.parsed_real_estate_properties(parking_count);

-- Optional: You can keep the parking boolean for backward compatibility
-- or remove it if you want to use parking_count only
-- ALTER TABLE public.parsed_real_estate_properties DROP COLUMN parking;
