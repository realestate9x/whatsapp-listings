import { Request, Response } from "express";
import {
  createAuthenticatedSupabaseClient,
  WhatsAppMessage,
} from "../lib/supabase";

export const getMessages = async (req: Request, res: Response) => {
  try {
    const userToken = req.headers.authorization?.replace("Bearer ", "");

    if (!userToken) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const supabase = createAuthenticatedSupabaseClient(userToken);
    const { group_name, limit = 50, offset = 0 } = req.query;

    // Query all messages - RLS policies will handle access control
    let query = supabase
      .from("whatsapp_messages")
      .select("*")
      .order("timestamp", { ascending: false });

    if (group_name) {
      query = query.eq("group_name", group_name);
    }

    const { data, error } = await query.range(
      Number(offset),
      Number(offset) + Number(limit) - 1
    );

    if (error) {
      console.error("Error fetching messages:", error);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }

    res.json({
      messages: data,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        count: data?.length || 0,
      },
    });
  } catch (error) {
    console.error("Error in getMessages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMessagesByGroup = async (req: Request, res: Response) => {
  try {
    const userToken = req.headers.authorization?.replace("Bearer ", "");

    if (!userToken) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const supabase = createAuthenticatedSupabaseClient(userToken);
    const { groupName } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Query all messages for the group - RLS policies will handle access control
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("group_name", groupName)
      .order("timestamp", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      console.error("Error fetching messages by group:", error);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }

    res.json({
      messages: data,
      group_name: groupName,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        count: data?.length || 0,
      },
    });
  } catch (error) {
    console.error("Error in getMessagesByGroup:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getGroupsList = async (req: Request, res: Response) => {
  try {
    const userToken = req.headers.authorization?.replace("Bearer ", "");

    if (!userToken) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const supabase = createAuthenticatedSupabaseClient(userToken);

    // Get all messages to process groups - RLS policies will handle access control
    const { data: allMessages, error } = await supabase
      .from("whatsapp_messages")
      .select("group_name, group_id, timestamp");

    if (error) {
      console.error("Error counting messages:", error);
      return res.status(500).json({ error: "Failed to count messages" });
    }

    // Process groups with statistics
    const groupsMap = new Map();
    allMessages?.forEach((msg) => {
      const key = msg.group_name;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          group_name: msg.group_name,
          group_id: msg.group_id,
          message_count: 0,
          last_message: null,
        });
      }
      const group = groupsMap.get(key);
      group.message_count++;
      if (
        !group.last_message ||
        new Date(msg.timestamp) > new Date(group.last_message)
      ) {
        group.last_message = msg.timestamp;
      }
    });

    const groups = Array.from(groupsMap.values()).sort(
      (a, b) =>
        new Date(b.last_message).getTime() - new Date(a.last_message).getTime()
    );

    res.json({ groups });
  } catch (error) {
    console.error("Error in getGroupsList:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const storeMessage = async (
  messageData: WhatsAppMessage,
  userToken: string
) => {
  try {
    const supabase = createAuthenticatedSupabaseClient(userToken);

    const { data, error } = await supabase
      .from("whatsapp_messages")
      .insert([messageData])
      .select();

    if (error) {
      console.error("Error storing message:", error);
      throw error;
    }

    return data[0];
  } catch (error) {
    console.error("Error in storeMessage:", error);
    throw error;
  }
};
