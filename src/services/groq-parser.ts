import Groq from "groq-sdk";

export interface ParsedRealEstateData {
  property_name?: string;
  property_type?: string;
  listing_type: "sale" | "rental" | "lease";
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
  furnishing?: "furnished" | "semi-furnished" | "unfurnished";
  parking?: boolean;
  parking_count?: number;
  contact_info?: string;
  availability_date?: string;
  description?: string;
  parsing_confidence?: number;
}

export interface ParsedRealEstateResult {
  properties: ParsedRealEstateData[];
  rawResponse: any;
}

export class GroqRealEstateParser {
  private groq: Groq;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY environment variable is required");
    }
    this.groq = new Groq({ apiKey });
  }

  async parseRealEstateMessage(
    messageText: string
  ): Promise<ParsedRealEstateResult> {
    // For backward compatibility, wrap single message in batch
    const results = await this.parseRealEstateMessagesBatch([messageText]);
    return results[0];
  }

  async parseRealEstateMessagesBatch(
    messageTexts: string[]
  ): Promise<ParsedRealEstateResult[]> {
    try {
      const prompt = this.createBatchParsingPrompt(messageTexts);

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert real estate message parser. Parse WhatsApp messages about real estate properties (both sale and rental) and extract structured data. Always respond with valid JSON only, no additional text.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        model: "llama3-8b-8192",
        temperature: 0.1,
        max_tokens: 4000, // Increased for batch processing
        response_format: { type: "json_object" },
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error("No response from Groq API");
      }

      const parsedResponse = JSON.parse(responseText);

      // Validate the batch response structure
      if (!parsedResponse.results || !Array.isArray(parsedResponse.results)) {
        throw new Error(
          "Invalid batch response format - expected results array"
        );
      }

      if (parsedResponse.results.length !== messageTexts.length) {
        throw new Error(
          `Expected ${messageTexts.length} results, got ${parsedResponse.results.length}`
        );
      }

      // Validate and normalize each parsed result
      const results = parsedResponse.results.map(
        (messageResult: any, index: number) => {
          try {
            // Handle the new nested structure with properties array
            const properties = messageResult.properties || [];
            const normalizedProperties = properties.map((propertyData: any) => {
              return this.validateAndNormalizeData(propertyData);
            });

            return {
              properties: normalizedProperties,
              rawResponse: completion,
            };
          } catch (error) {
            console.error(`Error validating result ${index}:`, error);
            // Return a fallback result for invalid data
            return {
              properties: [],
              rawResponse: completion,
            };
          }
        }
      );

      return results;
    } catch (error) {
      console.error("Error parsing messages batch with Groq:", error);
      throw new Error(
        `Failed to parse message batch: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private createBatchParsingPrompt(messageTexts: string[]): string {
    const messagesWithIndex = messageTexts
      .map(
        (text, index) =>
          `Message ${index + 1}:
"""
${text}
"""
`
      )
      .join("\n");

    return `
Parse these ${messageTexts.length} WhatsApp real estate messages and extract structured data for each. Return a JSON object with the following structure:

{
  "results": [
    {
      "properties": [
        {
          "property_name": "string or null",
          "property_type": "apartment|house|villa|commercial|office|shop|warehouse|land|other or null",
          "listing_type": "sale|rental|lease",
          "price": "string or null (original price text)",
          "price_numeric": "number or null (numeric value in rupees for sorting)",
          "location": "string or null (full address/location)",
          "area_name": "string or null (neighborhood/area name)",
          "city": "string or null",
          "bedrooms": "number or null",
          "bathrooms": "number or null",
          "area_sqft": "number or null",
          "floor_number": "number or null",
          "total_floors": "number or null",
          "amenities": ["array of strings or null"],
          "furnishing": "furnished|semi-furnished|unfurnished or null",
          "parking": "boolean or null (true if parking available)",
          "parking_count": "number or null (number of parking spaces)",
          "contact_info": "string or null (phone/email/contact details)",
          "availability_date": "string or null (YYYY-MM-DD format)",
          "description": "string or null (additional details)",
          "parsing_confidence": "number between 0 and 1"
        }
        // If both sale and rental are mentioned, create separate objects with different listing_type and prices
      ]
    }
    // ... repeat for each message
  ]
}

Messages to parse:
${messagesWithIndex}

Guidelines:
- Process each message in order and return results in the same order
- If a message contains both sale and rental information, create TWO separate property objects with different listing_type and prices
- If a message is not about real estate, return empty properties array
- Extract contact information (phone numbers, emails) into contact_info
- Convert area measurements to square feet if possible
- Identify amenities like gym, pool, parking, security, etc.
- Determine if it's for sale, rental, or lease based on context
- Sale: Property being sold permanently
- Rental: Property being rented (monthly/yearly)
- Lease: Property being leased (usually longer term, commercial or residential)
- Set parsing_confidence based on how clear and complete the information is
- Extract numeric values from price text (e.g., "₹50,000" -> price_numeric: 50000)
- Extract parking information: set parking=true if parking is available, parking_count=number of spaces
- All prices are assumed to be in Indian Rupees (INR)
- Be conservative with parsing_confidence - only use high values (>0.8) when information is very clear
- For dual listings (sale + rental), copy all property details but change listing_type and price accordingly
- The results array must contain exactly ${messageTexts.length} objects in the same order as the input messages

Return only the JSON object, no additional text.
`;
  }

  private createParsingPrompt(messageText: string): string {
    return `
Parse this WhatsApp real estate message and extract structured data. Return a JSON object with the following structure:

{
  "property_name": "string or null",
  "property_type": "apartment|house|villa|commercial|office|shop|warehouse|land|other or null",      "listing_type": "sale|rental|lease",
      "price": "string or null (original price text)",
      "price_numeric": "number or null (numeric value in rupees for sorting)",
      "location": "string or null (full address/location)",
  "area_name": "string or null (neighborhood/area name)",
  "city": "string or null",
  "bedrooms": "number or null",
  "bathrooms": "number or null",
  "area_sqft": "number or null",
  "floor_number": "number or null",
  "total_floors": "number or null",
  "amenities": ["array of strings or null"],
  "furnishing": "furnished|semi-furnished|unfurnished or null",
  "parking": "boolean or null (true if parking available)",
  "parking_count": "number or null (number of parking spaces)",
  "contact_info": "string or null (phone/email/contact details)",
  "availability_date": "string or null (YYYY-MM-DD format)",
  "description": "string or null (additional details)",
  "parsing_confidence": "number between 0 and 1"
}

Message to parse:
"""
${messageText}
"""

Guidelines:
- If the message is not about real estate, set listing_type to null and parsing_confidence to 0
- Extract contact information (phone numbers, emails) into contact_info
- Convert area measurements to square feet if possible
- Identify amenities like gym, pool, parking, security, etc.
- Determine if it's for sale, rental, or lease based on context
- Sale: Property being sold permanently
- Rental: Property being rented (monthly/yearly)
- Lease: Property being leased (usually longer term, commercial or residential)
- Set parsing_confidence based on how clear and complete the information is
- Extract numeric values from price text (e.g., "₹50,000" -> price_numeric: 50000)
- Extract parking information: set parking=true if parking is available, parking_count=number of spaces
- All prices are assumed to be in Indian Rupees (INR)
- Be conservative with parsing_confidence - only use high values (>0.8) when information is very clear

Return only the JSON object, no additional text.
`;
  }

  private validateAndNormalizeData(data: any): ParsedRealEstateData {
    // Ensure required fields
    if (
      !data.listing_type ||
      !["sale", "rental", "lease"].includes(data.listing_type)
    ) {
      data.listing_type = null;
      data.parsing_confidence = 0;
    }

    // Normalize property type
    if (data.property_type) {
      const validTypes = [
        "apartment",
        "house",
        "villa",
        "commercial",
        "office",
        "shop",
        "warehouse",
        "land",
        "other",
      ];
      if (!validTypes.includes(data.property_type.toLowerCase())) {
        data.property_type = "other";
      }
    }

    // Normalize furnishing
    if (data.furnishing) {
      const validFurnishing = ["furnished", "semi-furnished", "unfurnished"];
      if (!validFurnishing.includes(data.furnishing.toLowerCase())) {
        data.furnishing = null;
      }
    }

    // Ensure confidence is between 0 and 1
    if (data.parsing_confidence > 1) {
      data.parsing_confidence = 1;
    } else if (data.parsing_confidence < 0) {
      data.parsing_confidence = 0;
    }

    // Clean up numeric fields
    const numericFields = [
      "price_numeric",
      "bedrooms",
      "bathrooms",
      "area_sqft",
      "floor_number",
      "total_floors",
      "parking_count",
    ];
    numericFields.forEach((field) => {
      if (data[field] !== null && data[field] !== undefined) {
        const num = parseInt(data[field]);
        data[field] = isNaN(num) ? null : num;
      }
    });

    // Handle parking field - convert parking count to boolean and extract count
    if (data.parking !== null && data.parking !== undefined) {
      if (typeof data.parking === "string") {
        const parkingNum = parseInt(data.parking);
        if (!isNaN(parkingNum)) {
          data.parking_count = parkingNum;
          data.parking = parkingNum > 0;
        } else {
          data.parking = null;
          data.parking_count = null;
        }
      } else if (typeof data.parking === "number") {
        data.parking_count = data.parking;
        data.parking = data.parking > 0;
      } else if (typeof data.parking !== "boolean") {
        data.parking = null;
        data.parking_count = null;
      }
    }

    // Ensure amenities is an array
    if (data.amenities && !Array.isArray(data.amenities)) {
      data.amenities = null;
    }

    return data;
  }
}
