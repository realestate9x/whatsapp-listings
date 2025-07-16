-- Migration: Create parsed_real_estate_properties table
-- Run this SQL in your Supabase SQL Editor

-- Create parsed_real_estate_properties table
CREATE TABLE public.parsed_real_estate_properties (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    
    -- Property basic info
    property_name text,
    property_type text, -- apartment, house, villa, commercial, etc.
    listing_type text NOT NULL, -- sale, rental, lease
    
    -- Pricing
    price text,
    price_numeric numeric, -- All prices in Indian Rupees (INR) -- For sorting/filtering
    
    -- Location
    location text,
    area_name text,
    city text,
    
    -- Property details
    bedrooms integer,
    bathrooms integer,
    area_sqft integer,
    floor_number integer,
    total_floors integer,
    
    -- Features
    amenities text[], -- Array of amenities
    furnishing text, -- furnished, semi-furnished, unfurnished
    parking boolean,
    parking_count integer, -- Number of parking spaces
    
    -- Contact & availability
    contact_info text,
    availability_date date,
    
    -- Additional info
    description text,
    raw_message_text text, -- Store original message for reference
    
    -- Parsing metadata
    parsing_confidence numeric(3,2), -- 0.00 to 1.00
    groq_response jsonb, -- Store full Groq response for debugging
    
    -- Timestamps
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    
    CONSTRAINT parsed_real_estate_properties_pkey PRIMARY KEY (id),
    CONSTRAINT parsed_real_estate_properties_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_parsed_properties_message_id ON public.parsed_real_estate_properties(message_id);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_user_id ON public.parsed_real_estate_properties(user_id);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_listing_type ON public.parsed_real_estate_properties(listing_type);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_property_type ON public.parsed_real_estate_properties(property_type);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_location ON public.parsed_real_estate_properties(location);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_price_numeric ON public.parsed_real_estate_properties(price_numeric);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_bedrooms ON public.parsed_real_estate_properties(bedrooms);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_parking_count ON public.parsed_real_estate_properties(parking_count);
CREATE INDEX IF NOT EXISTS idx_parsed_properties_created_at ON public.parsed_real_estate_properties(created_at);

-- Full-text search index for property search
CREATE INDEX IF NOT EXISTS idx_parsed_properties_text_search ON public.parsed_real_estate_properties 
USING gin(to_tsvector('english', coalesce(property_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '')));

-- Enable Row Level Security
ALTER TABLE public.parsed_real_estate_properties ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow read access for all users
CREATE POLICY "Enable read for all" ON public.parsed_real_estate_properties
    FOR SELECT 
    USING (true);

-- RLS Policy: Allow insert/update for system operations
CREATE POLICY "Enable insert for system" ON public.parsed_real_estate_properties
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Enable update for system" ON public.parsed_real_estate_properties
    FOR UPDATE 
    USING (true)
    WITH CHECK (true);
