# Real Estate Message Parsing Setup

This guide explains how to set up the AI-powered real estate message parsing system that automatically processes WhatsApp messages and extracts structured property data.

## Overview

The system uses Groq AI to parse WhatsApp messages about real estate properties (both sale and rental) and stores the extracted data in a structured format for easy searching and filtering. The system processes messages in batches of 10 to optimize API usage and improve performance.

## Prerequisites

1. **Groq API Key**: Sign up at [Groq Console](https://console.groq.com/) and get your API key
2. **Database Migration**: Run the required database migrations
3. **Environment Variables**: Configure the Groq API key

## Database Setup

### Step 1: Add processed column to existing table

Run this SQL in your Supabase SQL Editor:

```sql
-- Add processed column to track which messages have been parsed
ALTER TABLE public.whatsapp_messages
ADD COLUMN IF NOT EXISTS processed boolean DEFAULT false;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_processed ON public.whatsapp_messages(processed);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unprocessed_timestamp ON public.whatsapp_messages(processed, timestamp) WHERE processed = false;
```

### Step 2: Create parsed properties table

Run this SQL in your Supabase SQL Editor:

```sql
-- Create parsed_real_estate_properties table
CREATE TABLE public.parsed_real_estate_properties (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,

    -- Property basic info
    property_name text,
    property_type text,
    listing_type text NOT NULL,

    -- Pricing
    price text,
    price_numeric numeric, -- All prices in Indian Rupees (INR)

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
    amenities text[],
    furnishing text,
    parking boolean,

    -- Contact & availability
    contact_info text,
    availability_date date,

    -- Additional info
    description text,
    raw_message_text text,

    -- Parsing metadata
    parsing_confidence numeric(3,2),
    groq_response jsonb,

    -- Timestamps
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT parsed_real_estate_properties_pkey PRIMARY KEY (id),
    CONSTRAINT parsed_real_estate_properties_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE
);

-- Create indexes and RLS policies
-- (See migration-create-parsed-properties-table.sql for complete setup)
```

## Environment Configuration

Add your Groq API key to your `.env` file:

```bash
GROQ_API_KEY=your-groq-api-key-here
```

## API Endpoints

### Job Management

- **POST /api/parsing-job/start** - Start the recurring parsing job
- **POST /api/parsing-job/stop** - Stop the recurring parsing job
- **POST /api/parsing-job/process** - Manually process messages
- **GET /api/parsing-job/status** - Get job status and statistics

### Data Access

- **GET /api/parsing-job/properties** - Search parsed properties with filters
- **GET /api/parsing-job/stats** - Get basic statistics (public endpoint)

## Usage Examples

### 1. Start the Recurring Job

```bash
curl -X POST http://localhost:3000/api/parsing-job/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"interval": 5}'
```

### 2. Process Messages Manually

```bash
curl -X POST http://localhost:3000/api/parsing-job/process \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 10}'
```

### 3. Search Properties

```bash
# Search for rental apartments
curl "http://localhost:3000/api/parsing-job/properties?listing_type=rental&property_type=apartment&min_confidence=0.5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Search by location
curl "http://localhost:3000/api/parsing-job/properties?location=Mumbai&bedrooms=2" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Get Statistics

```bash
curl http://localhost:3000/api/parsing-job/stats
```

## Search Filters

The `/api/parsing-job/properties` endpoint supports these filters:

- `listing_type`: 'sale' or 'rental'
- `property_type`: 'apartment', 'house', 'villa', 'commercial', etc.
- `location`: Search in location field (partial match)
- `min_price`, `max_price`: Price range filtering
- `bedrooms`: Exact number of bedrooms
- `min_confidence`: Minimum parsing confidence (0.0 to 1.0)
- `limit`: Maximum number of results (default: 50)

## Data Structure

The parsed properties table stores:

- **Basic Info**: Property name, type, listing type (sale/rental)
- **Pricing**: Price text, numeric value (all prices in Indian Rupees)
- **Location**: Address, area, city
- **Details**: Bedrooms, bathrooms, area, floor info
- **Features**: Amenities, furnishing, parking
- **Contact**: Contact information, availability date
- **Metadata**: Parsing confidence, original message text

## Monitoring

- Check job status with `/api/parsing-job/status`
- Monitor processing statistics with `/api/parsing-job/stats`
- View parsed properties with confidence scores
- Access original message text for verification

## Job Configuration

The recurring job processes messages every 5 minutes by default. You can customize:

- **Interval**: Time between processing runs (in minutes)
- **Batch Size**: Number of messages to fetch at once (default: 10)
- **Batch Processing**: Messages are processed in batches of 10 per API call to optimize performance
- **Confidence Threshold**: Minimum confidence to save properties (0.3 by default)

## Troubleshooting

1. **Job not starting**: Check Groq API key and database connection
2. **Low parsing accuracy**: Review message format and adjust prompts
3. **Rate limiting**: Increase delays between API calls
4. **Database errors**: Verify table structure and permissions

## Security Notes

- All job management endpoints require JWT authentication
- Only the stats endpoint is public (no sensitive data exposed)
- Service role key is used for database operations
- Rate limiting is implemented to avoid API abuse
