/**
 * Property Message Filter
 *
 * This utility filters WhatsApp messages to identify potential property listings
 * before they reach the AI parser. It uses keyword matching, pattern recognition,
 * and scoring to determine if a message is likely a property listing.
 */

export interface PropertyFilterResult {
  isPropertyListing: boolean;
  confidence: number;
  matchedKeywords: string[];
  matchedPatterns: string[];
  reason: string;
}

export class PropertyMessageFilter {
  private static readonly PROPERTY_KEYWORDS = [
    // Property types
    "apartment",
    "flat",
    "house",
    "villa",
    "plot",
    "land",
    "commercial",
    "office",
    "shop",
    "warehouse",
    "pg",
    "hostel",
    "building",
    "tower",
    "society",
    "complex",
    "residence",
    "project",

    // BHK patterns
    "bhk",
    "bedroom",
    "room",
    "hall",
    "kitchen",

    // Transaction types
    "sale",
    "rent",
    "lease",
    "buy",
    "sell",
    "available",
    "booking",
    "possession",
    "handover",
    "ready",
    "under construction",

    // Property features
    "furnished",
    "unfurnished",
    "semi-furnished",
    "semi furnished",
    "bathroom",
    "washroom",
    "balcony",
    "terrace",
    "garden",
    "parking",
    "covered parking",
    "open parking",
    "car park",
    "lift",
    "elevator",
    "security",
    "gated",
    "amenities",

    // Area measurements
    "sqft",
    "sq ft",
    "sq.ft",
    "square feet",
    "area",
    "carpet",
    "built up",
    "builtup",
    "super area",
    "super built up",

    // Price indicators
    "price",
    "rent",
    "lakh",
    "crore",
    "thousand",
    "deposit",
    "advance",
    "brokerage",
    "commission",
    "token",
    "booking amount",
    "maintenance",
    "monthly",
    "yearly",
    "per month",
    "per year",

    // Location indicators
    "near",
    "close to",
    "walking distance",
    "metro",
    "station",
    "school",
    "hospital",
    "mall",
    "market",
    "road",
    "street",
    "lane",
    "avenue",
    "cross",
    "junction",
    "circle",

    // Amenities
    "gym",
    "swimming pool",
    "pool",
    "club house",
    "clubhouse",
    "play area",
    "playground",
    "garden",
    "park",
    "jogging track",
    "cctv",
    "intercom",
    "power backup",
    "generator",
    "water supply",
    "bore well",
    "tank",
    "wifi",
    "broadband",
  ];

  private static readonly EXCLUSION_KEYWORDS = [
    "good morning",
    "good evening",
    "good night",
    "good afternoon",
    "how are you",
    "how r u",
    "thanks",
    "thank you",
    "welcome",
    "ok",
    "okay",
    "yes",
    "no",
    "sure",
    "fine",
    "alright",
    "happy birthday",
    "congratulations",
    "congrats",
    "best wishes",
    "get well soon",
    "take care",
    "have a good day",
    "see you",
    "bye",
    "goodbye",
    "tc",
    "gm",
    "gn",
    "gud mrng",
  ];

  private static readonly PRICE_PATTERNS = [
    /₹\s*\d+(?:[,\s]\d+)*(?:\.\d+)?(?:\s*(?:lakh|crore|k|thousand))?/gi,
    /rs\.?\s*\d+(?:[,\s]\d+)*(?:\.\d+)?(?:\s*(?:lakh|crore|k|thousand))?/gi,
    /\d+(?:[,\s]\d+)*(?:\.\d+)?\s*(?:lakh|crore|k|thousand)/gi,
    /\d+(?:[,\s]\d+)*(?:\.\d+)?\s*(?:per\s*month|per\s*year|monthly|yearly)/gi,
  ];

  private static readonly BHK_PATTERNS = [
    /\d+\s*bhk/gi,
    /\d+\s*bed\s*room/gi,
    /\d+\s*br/gi,
    /\d+\s*b\s*h\s*k/gi,
  ];

  private static readonly AREA_PATTERNS = [
    /\d+\s*(?:sq\s*ft|sqft|sq\.ft|square\s*feet)/gi,
    /\d+\s*(?:sq\s*m|sqm|square\s*meter)/gi,
    /area\s*[:=]\s*\d+/gi,
    /carpet\s*[:=]\s*\d+/gi,
  ];

  private static readonly CONTACT_PATTERNS = [
    /\d{10}/g, // 10-digit phone numbers
    /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, // Phone with separators
    /\+91[-.\s]?\d{10}/g, // Indian country code
    /contact\s*[:=]\s*\d+/gi,
    /call\s*[:=]\s*\d+/gi,
  ];

  private static readonly FLOOR_PATTERNS = [
    /\d+(?:st|nd|rd|th)?\s*floor/gi,
    /floor\s*[:=]\s*\d+/gi,
    /ground\s*floor/gi,
    /basement/gi,
  ];

  /**
   * Filters a message to determine if it's likely a property listing
   */
  public static filterMessage(message: string): PropertyFilterResult {
    if (!message || typeof message !== "string") {
      return {
        isPropertyListing: false,
        confidence: 0,
        matchedKeywords: [],
        matchedPatterns: [],
        reason: "Invalid or empty message",
      };
    }

    const text = message.toLowerCase().trim();

    // Quick exclusion check for common non-property messages
    const hasExclusionKeywords = this.EXCLUSION_KEYWORDS.some((keyword) =>
      text.includes(keyword.toLowerCase())
    );

    if (hasExclusionKeywords && text.length < 50) {
      return {
        isPropertyListing: false,
        confidence: 0,
        matchedKeywords: [],
        matchedPatterns: [],
        reason: "Contains exclusion keywords and is too short",
      };
    }

    // Check for property keywords
    const matchedKeywords = this.PROPERTY_KEYWORDS.filter((keyword) =>
      text.includes(keyword.toLowerCase())
    );

    // Check for patterns
    const matchedPatterns: string[] = [];
    const patterns = {
      price: this.PRICE_PATTERNS,
      bhk: this.BHK_PATTERNS,
      area: this.AREA_PATTERNS,
      contact: this.CONTACT_PATTERNS,
      floor: this.FLOOR_PATTERNS,
    };

    let totalPatternMatches = 0;
    Object.entries(patterns).forEach(([patternType, patternArray]) => {
      for (const pattern of patternArray) {
        if (pattern.test(text)) {
          matchedPatterns.push(patternType);
          totalPatternMatches++;
          break; // Only count each pattern type once
        }
      }
    });

    // Message structure analysis
    const lines = message.split("\n").filter((line) => line.trim().length > 0);
    const hasMultipleLines = lines.length > 2;
    const hasNumbers = /\d+/.test(message);
    const wordCount = message.split(/\s+/).length;
    const hasEmojis =
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
        message
      );

    // Calculate confidence score
    let score = 0;
    const reasons: string[] = [];

    // Keyword scoring
    if (matchedKeywords.length >= 3) {
      score += 25;
      reasons.push(`${matchedKeywords.length} property keywords`);
    } else if (matchedKeywords.length >= 2) {
      score += 15;
      reasons.push(`${matchedKeywords.length} property keywords`);
    } else if (matchedKeywords.length >= 1) {
      score += 5;
      reasons.push(`${matchedKeywords.length} property keyword`);
    }

    // Pattern scoring
    if (matchedPatterns.includes("price")) {
      score += 20;
      reasons.push("price pattern");
    }
    if (matchedPatterns.includes("bhk")) {
      score += 20;
      reasons.push("BHK pattern");
    }
    if (matchedPatterns.includes("area")) {
      score += 15;
      reasons.push("area pattern");
    }
    if (matchedPatterns.includes("contact")) {
      score += 10;
      reasons.push("contact pattern");
    }
    if (matchedPatterns.includes("floor")) {
      score += 5;
      reasons.push("floor pattern");
    }

    // Structure scoring
    if (hasMultipleLines && wordCount > 15) {
      score += 10;
      reasons.push("structured format");
    }
    if (hasNumbers && wordCount > 10) {
      score += 5;
      reasons.push("contains numbers");
    }
    if (hasEmojis && matchedKeywords.length > 0) {
      score += 5;
      reasons.push("formatted with emojis");
    }

    // Length bonus for detailed messages
    if (wordCount > 20 && matchedKeywords.length > 0) {
      score += 5;
      reasons.push("detailed message");
    }

    // Penalty for very short messages without strong indicators
    if (wordCount < 5 && matchedKeywords.length < 2) {
      score -= 10;
      reasons.push("too short");
    }

    const confidence = Math.min(100, Math.max(0, score));
    const isPropertyListing = confidence >= 60; // 60% confidence threshold

    return {
      isPropertyListing,
      confidence: confidence / 100, // Convert to 0-1 range
      matchedKeywords,
      matchedPatterns,
      reason: reasons.join(", ") || "No significant indicators",
    };
  }

  /**
   * Batch filter multiple messages
   */
  public static filterMessages(messages: string[]): PropertyFilterResult[] {
    return messages.map((message) => this.filterMessage(message));
  }

  /**
   * Get only property listings from a batch of messages
   */
  public static getPropertyListings(
    messages: string[],
    minConfidence: number = 0.6
  ): {
    message: string;
    result: PropertyFilterResult;
  }[] {
    return messages
      .map((message) => ({
        message,
        result: this.filterMessage(message),
      }))
      .filter(
        (item) =>
          item.result.isPropertyListing &&
          item.result.confidence >= minConfidence
      );
  }
}
