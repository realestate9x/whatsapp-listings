# Entity Relationship Diagram (ERD)

## WhatsApp Real Estate Bot Database Schema

## Database Schema Overview

This document describes the database schema for the WhatsApp Real Estate Bot application.

## Tables

### whatsapp_messages

This table stores all WhatsApp messages from monitored groups.

| Column         | Type                       | Constraints                                       | Description                                             |
| -------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `id`           | `uuid`                     | PRIMARY KEY, NOT NULL, DEFAULT uuid_generate_v4() | Unique identifier for each message                      |
| `user_id`      | `uuid`                     | NOT NULL, NO FOREIGN KEY                          | System UUID for centralized storage                     |
| `timestamp`    | `timestamp with time zone` | NOT NULL                                          | When the message was sent in WhatsApp                   |
| `group_id`     | `text`                     | NOT NULL                                          | WhatsApp group JID (e.g., `120363401437046636@g.us`)    |
| `group_name`   | `text`                     | NOT NULL                                          | Human-readable group name (e.g., "Real Estate Connect") |
| `sender`       | `text`                     | NOT NULL                                          | WhatsApp participant JID who sent the message           |
| `message_text` | `text`                     | NULL                                              | Extracted plain text content from the message           |
| `message_meta` | `jsonb`                    | NOT NULL                                          | Full WhatsApp message object in JSON format             |
| `processed`    | `boolean`                  | DEFAULT false                                     | Whether the message has been processed by AI parser     |
| `created_at`   | `timestamp with time zone` | DEFAULT now()                                     | When the record was inserted into the database          |

### user_group_preferences

This table stores user preferences for group monitoring (optional - for future filtering).

| Column       | Type                       | Constraints                             | Description                                  |
| ------------ | -------------------------- | --------------------------------------- | -------------------------------------------- |
| `id`         | `uuid`                     | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique identifier for each preference        |
| `user_id`    | `uuid`                     | NOT NULL, REFERENCES auth.users(id)     | User ID from Supabase auth                   |
| `group_id`   | `text`                     | NOT NULL                                | WhatsApp group JID (e.g., `120363@g.us`)     |
| `group_name` | `text`                     | NOT NULL                                | Human-readable name of the WhatsApp group    |
| `is_enabled` | `boolean`                  | DEFAULT true                            | Whether monitoring is enabled for this group |
| `created_at` | `timestamp with time zone` | DEFAULT now()                           | When the preference was created              |
| `updated_at` | `timestamp with time zone` | DEFAULT now()                           | When the preference was last updated         |

Unique constraint: `(user_id, group_id)`

### parsed_real_estate_properties

This table stores structured real estate data parsed from WhatsApp messages using AI.

| Column               | Type                       | Constraints                                       | Description                                        |
| -------------------- | -------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `id`                 | `uuid`                     | PRIMARY KEY, NOT NULL, DEFAULT uuid_generate_v4() | Unique identifier for each parsed property         |
| `message_id`         | `uuid`                     | NOT NULL, REFERENCES whatsapp_messages(id)        | Reference to the original WhatsApp message         |
| `user_id`            | `uuid`                     | NOT NULL                                          | System UUID matching the original message          |
| `property_name`      | `text`                     | NULL                                              | Name/title of the property                         |
| `property_type`      | `text`                     | NULL                                              | Type: apartment, house, villa, commercial, etc.    |
| `listing_type`       | `text`                     | NOT NULL                                          | Type: sale, rental, lease                          |
| `price`              | `text`                     | NULL                                              | Price as text with currency (always in INR)        |
| `price_numeric`      | `numeric`                  | NULL                                              | Numeric price in rupees for sorting/filtering      |
| `location`           | `text`                     | NULL                                              | Full address/location                              |
| `area_name`          | `text`                     | NULL                                              | Area/neighborhood name                             |
| `city`               | `text`                     | NULL                                              | City name                                          |
| `bedrooms`           | `integer`                  | NULL                                              | Number of bedrooms                                 |
| `bathrooms`          | `integer`                  | NULL                                              | Number of bathrooms                                |
| `area_sqft`          | `integer`                  | NULL                                              | Area in square feet                                |
| `floor_number`       | `integer`                  | NULL                                              | Floor number                                       |
| `total_floors`       | `integer`                  | NULL                                              | Total floors in building                           |
| `amenities`          | `text[]`                   | NULL                                              | Array of amenities                                 |
| `furnishing`         | `text`                     | NULL                                              | Furnishing status: furnished, semi-furnished, etc. |
| `parking`            | `boolean`                  | NULL                                              | Whether parking is available                       |
| `parking_count`      | `integer`                  | NULL                                              | Number of parking spaces                           |
| `contact_info`       | `text`                     | NULL                                              | Contact information from message                   |
| `availability_date`  | `date`                     | NULL                                              | Available from date                                |
| `description`        | `text`                     | NULL                                              | Additional description/details                     |
| `raw_message_text`   | `text`                     | NULL                                              | Original message text for reference                |
| `parsing_confidence` | `numeric(3,2)`             | NULL                                              | AI parsing confidence score (0.00 to 1.00)         |
| `groq_response`      | `jsonb`                    | NULL                                              | Full Groq API response for debugging               |
| `created_at`         | `timestamp with time zone` | DEFAULT now()                                     | When the record was created                        |
| `updated_at`         | `timestamp with time zone` | DEFAULT now()                                     | When the record was last updated                   |

## ERD Diagram

```mermaid
erDiagram
    users {
        uuid id PK "Supabase auth.users"
        text email
        timestamptz created_at
        timestamptz updated_at
    }

    whatsapp_messages {
        uuid id PK "NOT NULL, DEFAULT uuid_generate_v4()"
        uuid user_id "NOT NULL, NO FOREIGN KEY - System UUID"
        timestamptz timestamp "NOT NULL - Message sent time"
        text group_id "NOT NULL - WhatsApp group JID"
        text group_name "NOT NULL - Human readable group name"
        text sender "NOT NULL - Sender participant JID"
        text message_text "NULL - Extracted plain text content"
        jsonb message_meta "NOT NULL - Full WhatsApp message object"
        boolean processed "DEFAULT false - Whether message has been AI parsed"
        timestamptz created_at "DEFAULT now() - Record creation time"
    }

    parsed_real_estate_properties {
        uuid id PK "NOT NULL, DEFAULT uuid_generate_v4()"
        uuid message_id "NOT NULL, FK to whatsapp_messages(id)"
        uuid user_id "NOT NULL - System UUID"
        text property_name "NULL - Property name/title"
        text property_type "NULL - apartment, house, villa, etc."
        text listing_type "NOT NULL - sale, rental, lease"
        text price "NULL - Price as text with currency (always INR)"
        numeric price_numeric "NULL - Numeric price in rupees for sorting"
        text location "NULL - Full address/location"
        text area_name "NULL - Area/neighborhood name"
        text city "NULL - City name"
        integer bedrooms "NULL - Number of bedrooms"
        integer bathrooms "NULL - Number of bathrooms"
        integer area_sqft "NULL - Area in square feet"
        integer floor_number "NULL - Floor number"
        integer total_floors "NULL - Total floors in building"
        text_array amenities "NULL - Array of amenities"
        text furnishing "NULL - Furnishing status"
        boolean parking "NULL - Parking availability"
        integer parking_count "NULL - Number of parking spaces"
        text contact_info "NULL - Contact information"
        date availability_date "NULL - Available from date"
        text description "NULL - Additional description"
        text raw_message_text "NULL - Original message text"
        numeric parsing_confidence "NULL - AI confidence score"
        jsonb groq_response "NULL - Full Groq API response"
        timestamptz created_at "DEFAULT now()"
        timestamptz updated_at "DEFAULT now()"
    }

    user_group_preferences {
        uuid id PK "NOT NULL, DEFAULT uuid_generate_v4()"
        uuid user_id "NOT NULL, FK to auth.users(id)"
        text group_id "NOT NULL - WhatsApp group JID"
        text group_name "NOT NULL - Human readable group name"
        boolean is_enabled "DEFAULT true"
        timestamptz created_at "DEFAULT now()"
        timestamptz updated_at "DEFAULT now()"
    }

    users ||--o{ user_group_preferences : "configures"
    whatsapp_messages ||--o| parsed_real_estate_properties : "parsed_into"
```

## Indexes

Consider adding these indexes for better performance:

```sql
-- Index for querying messages by user
CREATE INDEX idx_whatsapp_messages_user_id ON whatsapp_messages(user_id);

-- Index for querying messages by group
CREATE INDEX idx_whatsapp_messages_group_id ON whatsapp_messages(group_id);
CREATE INDEX idx_whatsapp_messages_group_name ON whatsapp_messages(group_name);

-- Index for time-based queries
CREATE INDEX idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);

-- Composite index for common queries
CREATE INDEX idx_whatsapp_messages_user_group_timestamp ON whatsapp_messages(user_id, group_name, timestamp DESC);

-- Index for user group preferences
CREATE INDEX idx_user_group_preferences_user_id ON user_group_preferences(user_id);

-- Full-text search index for message content
CREATE INDEX idx_whatsapp_messages_text_search ON whatsapp_messages USING gin(to_tsvector('english', message_text));

-- Index for processing status
CREATE INDEX idx_whatsapp_messages_processed ON whatsapp_messages(processed);
CREATE INDEX idx_whatsapp_messages_unprocessed_timestamp ON whatsapp_messages(processed, timestamp) WHERE processed = false;

-- Indexes for parsed properties
CREATE INDEX idx_parsed_properties_message_id ON parsed_real_estate_properties(message_id);
CREATE INDEX idx_parsed_properties_user_id ON parsed_real_estate_properties(user_id);
CREATE INDEX idx_parsed_properties_listing_type ON parsed_real_estate_properties(listing_type);
CREATE INDEX idx_parsed_properties_property_type ON parsed_real_estate_properties(property_type);
CREATE INDEX idx_parsed_properties_location ON parsed_real_estate_properties(location);
CREATE INDEX idx_parsed_properties_price_numeric ON parsed_real_estate_properties(price_numeric);
CREATE INDEX idx_parsed_properties_bedrooms ON parsed_real_estate_properties(bedrooms);
CREATE INDEX idx_parsed_properties_parking_count ON parsed_real_estate_properties(parking_count);
CREATE INDEX idx_parsed_properties_created_at ON parsed_real_estate_properties(created_at);

-- Full-text search index for property search
CREATE INDEX idx_parsed_properties_text_search ON parsed_real_estate_properties
USING gin(to_tsvector('english', coalesce(property_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '')));
```

## Notes

- **whatsapp_messages** uses a system UUID (`00000000-0000-0000-0000-000000000000`) for centralized storage
- **user_group_preferences** allows users to configure which groups to monitor
- **message_text** column provides fast text search capabilities without parsing JSONB
- **message_meta** column preserves full WhatsApp message structure for complex operations
- The system supports centralized message storage

## Performance Features

- **Full-text search**: `message_text` column with GIN index enables fast text search
- **Fast queries**: Plain text searches avoid expensive JSONB operations
- **API efficiency**: Most endpoints can return just `message_text` instead of full metadata
- **Indexing**: Optimized indexes for common query patterns
