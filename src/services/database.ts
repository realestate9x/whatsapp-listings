import { createClient } from "@supabase/supabase-js";
import { ParsedRealEstateData } from "./groq-parser";

export interface WhatsAppMessage {
  id: string;
  user_id: string;
  group_id: string;
  group_name: string;
  sender: string;
  message_text: string;
  message_meta: any;
  processed: boolean;
  created_at: string;
}

export interface ParsedRealEstateProperty {
  id: string;
  message_id: string;
  user_id: string;
  property_name?: string;
  property_type?: string;
  listing_type: string;
  price?: string;
  price_numeric?: number;
  location?: string;
  area_name?: string;
  city?: string;
  bedrooms?: number;
  bathrooms?: number;
  area_sqft?: number;
  floor_number?: number;
  total_floors?: number;
  amenities?: string[];
  furnishing?: string;
  parking?: boolean;
  parking_count?: number;
  contact_info?: string;
  availability_date?: string;
  description?: string;
  raw_message_text?: string;
  parsing_confidence?: number;
  groq_response?: any;
  created_at: string;
  updated_at: string;
}

export class DatabaseService {
  private supabase;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required"
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async getUnprocessedMessages(limit = 100): Promise<WhatsAppMessage[]> {
    const { data, error } = await this.supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("processed", false)
      .not("message_text", "is", null)
      .order("timestamp", { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch unprocessed messages: ${error.message}`);
    }

    return data || [];
  }

  async markMessageAsProcessed(messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from("whatsapp_messages")
      .update({ processed: true })
      .eq("id", messageId);

    if (error) {
      throw new Error(`Failed to mark message as processed: ${error.message}`);
    }
  }

  async saveParsedProperty(
    messageId: string,
    userId: string,
    parsedData: ParsedRealEstateData,
    rawMessageText: string,
    groqResponse: any
  ): Promise<ParsedRealEstateProperty> {
    const propertyData = {
      message_id: messageId,
      user_id: userId,
      property_name: parsedData.property_name || null,
      property_type: parsedData.property_type || null,
      listing_type: parsedData.listing_type,
      price: parsedData.price || null,
      price_numeric: parsedData.price_numeric || null,
      location: parsedData.location || null,
      area_name: parsedData.area_name || null,
      city: parsedData.city || null,
      bedrooms: parsedData.bedrooms || null,
      bathrooms: parsedData.bathrooms || null,
      area_sqft: parsedData.area_sqft || null,
      floor_number: parsedData.floor_number || null,
      total_floors: parsedData.total_floors || null,
      amenities: parsedData.amenities || null,
      furnishing: parsedData.furnishing || null,
      parking: parsedData.parking || null,
      parking_count: parsedData.parking_count || null,
      contact_info: parsedData.contact_info || null,
      availability_date: parsedData.availability_date || null,
      description: parsedData.description || null,
      raw_message_text: rawMessageText,
      parsing_confidence: parsedData.parsing_confidence || 0,
      groq_response: groqResponse,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("parsed_real_estate_properties")
      .insert([propertyData])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save parsed property: ${error.message}`);
    }

    return data;
  }

  async saveParsedProperties(
    messageId: string,
    userId: string,
    properties: ParsedRealEstateData[],
    rawMessageText: string,
    groqResponse: any
  ): Promise<ParsedRealEstateProperty[]> {
    const savedProperties: ParsedRealEstateProperty[] = [];

    for (const parsedData of properties) {
      const savedProperty = await this.saveParsedProperty(
        messageId,
        userId,
        parsedData,
        rawMessageText,
        groqResponse
      );
      savedProperties.push(savedProperty);
    }

    return savedProperties;
  }

  async getProcessingStats(): Promise<{
    totalMessages: number;
    processedMessages: number;
    unprocessedMessages: number;
    totalParsedProperties: number;
    averageConfidence: number;
  }> {
    // Get message counts
    const { data: messageStats, error: messageError } = await this.supabase
      .from("whatsapp_messages")
      .select("processed", { count: "exact" });

    if (messageError) {
      throw new Error(`Failed to get message stats: ${messageError.message}`);
    }

    const totalMessages = messageStats?.length || 0;
    const processedMessages =
      messageStats?.filter((m) => m.processed).length || 0;
    const unprocessedMessages = totalMessages - processedMessages;

    // Get parsed properties stats
    const { data: propertyStats, error: propertyError } = await this.supabase
      .from("parsed_real_estate_properties")
      .select("parsing_confidence", { count: "exact" });

    if (propertyError) {
      throw new Error(`Failed to get property stats: ${propertyError.message}`);
    }

    const totalParsedProperties = propertyStats?.length || 0;
    const averageConfidence =
      propertyStats?.length > 0
        ? propertyStats.reduce(
            (sum, p) => sum + (p.parsing_confidence || 0),
            0
          ) / propertyStats.length
        : 0;

    return {
      totalMessages,
      processedMessages,
      unprocessedMessages,
      totalParsedProperties,
      averageConfidence,
    };
  }

  async searchParsedProperties(filters: {
    listing_type?: "sale" | "rental" | "lease";
    property_type?: string;
    location?: string;
    min_price?: number;
    max_price?: number;
    bedrooms?: number;
    min_parking_count?: number;
    min_confidence?: number;
    limit?: number;
  }): Promise<ParsedRealEstateProperty[]> {
    let query = this.supabase.from("parsed_real_estate_properties").select("*");

    // Apply filters
    if (filters.listing_type) {
      query = query.eq("listing_type", filters.listing_type);
    }

    if (filters.property_type) {
      query = query.eq("property_type", filters.property_type);
    }

    if (filters.location) {
      query = query.ilike("location", `%${filters.location}%`);
    }

    if (filters.min_price) {
      query = query.gte("price_numeric", filters.min_price);
    }

    if (filters.max_price) {
      query = query.lte("price_numeric", filters.max_price);
    }

    if (filters.bedrooms) {
      query = query.eq("bedrooms", filters.bedrooms);
    }

    if (filters.min_parking_count) {
      query = query.gte("parking_count", filters.min_parking_count);
    }

    if (filters.min_confidence) {
      query = query.gte("parsing_confidence", filters.min_confidence);
    }

    query = query
      .order("created_at", { ascending: false })
      .limit(filters.limit || 50);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to search parsed properties: ${error.message}`);
    }

    return data || [];
  }
}
