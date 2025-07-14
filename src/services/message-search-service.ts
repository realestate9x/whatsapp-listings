import { supabaseAdmin } from "../lib/supabase";

export interface MessageSearchOptions {
  userId?: string;
  groupId?: string;
  groupName?: string;
  searchText?: string;
  limit?: number;
  offset?: number;
  fromDate?: string;
  toDate?: string;
}

export interface MessageSearchResult {
  id: string;
  timestamp: string;
  group_id: string;
  group_name: string;
  sender: string;
  message_text: string;
  created_at: string;
}

export class MessageSearchService {
  // Search messages with text content
  static async searchMessages(
    options: MessageSearchOptions
  ): Promise<MessageSearchResult[]> {
    let query = supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, timestamp, group_id, group_name, sender, message_text, created_at"
      )
      .order("timestamp", { ascending: false });

    // Apply filters
    if (options.userId) {
      query = query.eq("user_id", options.userId);
    }

    if (options.groupId) {
      query = query.eq("group_id", options.groupId);
    }

    if (options.groupName) {
      query = query.eq("group_name", options.groupName);
    }

    if (options.searchText) {
      // Use PostgreSQL full-text search for better performance
      query = query.textSearch("message_text", options.searchText);
    }

    if (options.fromDate) {
      query = query.gte("timestamp", options.fromDate);
    }

    if (options.toDate) {
      query = query.lte("timestamp", options.toDate);
    }

    // Apply pagination
    if (options.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 50) - 1
      );
    } else if (options.limit) {
      query = query.limit(options.limit);
    } else {
      query = query.limit(50); // Default limit
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error searching messages:", error);
      throw error;
    }

    return data || [];
  }

  // Get message with full metadata
  static async getMessageWithMeta(messageId: string) {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (error) {
      console.error("Error fetching message:", error);
      throw error;
    }

    return data;
  }

  // Get recent messages from a group
  static async getRecentGroupMessages(groupId: string, limit: number = 50) {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, timestamp, group_name, sender, message_text, created_at")
      .eq("group_id", groupId)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching group messages:", error);
      throw error;
    }

    return data || [];
  }

  // Get message statistics
  static async getMessageStats(userId?: string) {
    let query = supabaseAdmin
      .from("whatsapp_messages")
      .select("group_name, created_at", { count: "exact" });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Error fetching message stats:", error);
      throw error;
    }

    // Group by date and group
    const stats = {
      total_messages: count || 0,
      groups: {} as Record<string, number>,
      daily: {} as Record<string, number>,
    };

    data?.forEach((msg) => {
      // Count by group
      stats.groups[msg.group_name] = (stats.groups[msg.group_name] || 0) + 1;

      // Count by date
      const date = new Date(msg.created_at).toISOString().split("T")[0];
      stats.daily[date] = (stats.daily[date] || 0) + 1;
    });

    return stats;
  }
}
