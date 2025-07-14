import {
  WASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeWASocket,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { supabaseAdmin, WhatsAppMessage } from "../lib/supabase";
import path from "path";
import fs from "fs";

export class WhatsAppService {
  private targetGroups: string[] = []; // Will be loaded from database
  private sock: WASocket | undefined;
  private latestQR: string | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000; // 5 seconds
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    // Load persisted state and user preferences on startup
    this.loadPersistedState();
    // Load user preferences async (don't await in constructor)
    this.loadUserGroupPreferences().catch((error) => {
      console.error(
        "Failed to load user group preferences in constructor:",
        error
      );
    });
  }

  private saveStateToFile() {
    const state = {
      isConnected: this.isConnected,
      latestQR: this.latestQR,
      timestamp: Date.now(),
      userId: this.userId,
    };

    try {
      const stateDir = path.join(process.cwd(), "whatsapp-state");

      // Ensure directory exists
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      const stateFile = path.join(
        stateDir,
        `whatsapp-state-${this.userId}.json`
      );
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn(
        `Failed to save WhatsApp state for user ${this.userId}:`,
        error
      );
    }
  }

  private loadPersistedState() {
    try {
      const stateDir = path.join(process.cwd(), "whatsapp-state");
      const stateFile = path.join(
        stateDir,
        `whatsapp-state-${this.userId}.json`
      );

      if (fs.existsSync(stateFile)) {
        const stateData = fs.readFileSync(stateFile, "utf8");
        const state = JSON.parse(stateData);

        // Only restore recent state (within last 10 minutes)
        const timeDiff = Date.now() - (state.timestamp || 0);
        if (timeDiff < 10 * 60 * 1000) {
          // 10 minutes
          this.latestQR = state.latestQR;
          // Don't restore isConnected as we need to verify the actual connection
        }
      }
    } catch (error) {
      console.warn(
        `Failed to load persisted WhatsApp state for user ${this.userId}:`,
        error
      );
    }
  }

  private async scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Manual restart required.`
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    console.log(
      `🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${
        this.maxReconnectAttempts
      } in ${delay / 1000}s`
    );

    setTimeout(async () => {
      try {
        await this.startConnection();
      } catch (error) {
        console.error("Reconnection failed:", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  // Connection management methods
  async startConnection(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(
      `auth_info_baileys_${this.userId}`
    );
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      syncFullHistory: true,
      browser: ["Ubuntu", "Chrome", "22.04.4"],
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      console.log(`📨 Message upsert type: ${type}, count: ${messages.length}`);

      if (type === "notify" || type === "append") {
        for (const msg of messages) {
          if (this.sock) {
            await this.handleMessage(msg, type, this.sock);
          }
        }
      }
    });

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(
          `\n🔗 QR Code generated for user ${this.userId}! Access it via /status endpoint`
        );
        this.latestQR = qr;
      }

      if (connection === "close") {
        this.isConnected = false;
        console.log(`❌ WhatsApp connection closed for user ${this.userId}`);
        const disconnectError = lastDisconnect?.error as any;
        console.error("🛑 Connection closed due to:", disconnectError);

        const shouldReconnect =
          disconnectError?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`🔄 Attempting to reconnect user ${this.userId}...`);
          this.scheduleReconnect();
        } else {
          console.log(
            `🚪 User ${this.userId} logged out - please restart the application`
          );
        }
      }

      if (connection === "open") {
        this.isConnected = true;
        this.latestQR = null;
        this.reconnectAttempts = 0; // Reset reconnect attempts on success
        console.log(
          `✅ WhatsApp connected successfully for user ${this.userId}!`
        );
        console.log(
          `👂 Now listening for messages from target groups for user ${this.userId}...`
        );

        // Reload user preferences when connection is established
        this.loadUserGroupPreferences().catch((error) => {
          console.error("Failed to load user group preferences:", error);
        });
      }

      // Save state on every connection update
      this.saveStateToFile();
    });
  }

  // Auto-initialize connection on startup if auth exists
  async autoStartIfPossible(): Promise<boolean> {
    try {
      const authDir = `auth_info_baileys_${this.userId}`;
      // Check if we have existing auth credentials for this user
      if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
        console.log(
          `📱 Found existing WhatsApp auth for user ${this.userId}, attempting auto-connection...`
        );
        await this.startConnection();
        return true;
      } else {
        console.log(
          `📱 No existing WhatsApp auth found for user ${this.userId}, manual connection required`
        );
        return false;
      }
    } catch (error) {
      console.error("Failed to auto-start WhatsApp connection:", error);
      return false;
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      qrCode: this.latestQR,
      socketActive: !!this.sock,
      status: this.isConnected
        ? "connected"
        : this.latestQR
        ? "qr_ready"
        : "disconnected",
      message: this.isConnected
        ? "WhatsApp is connected"
        : this.latestQR
        ? "QR code ready"
        : "Not connected",
    };
  }

  async initializeIfNeeded(): Promise<{
    status: string;
    message: string;
    isConnected: boolean;
    qrCode: string | null;
  }> {
    if (this.isConnected) {
      return {
        status: "connected",
        message: "WhatsApp is connected",
        isConnected: true,
        qrCode: null,
      };
    }

    if (!this.sock) {
      await this.startConnection();
      // Wait a moment for QR to be generated
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (this.latestQR) {
        return {
          status: "qr_ready",
          message: "QR code ready. Please scan it.",
          isConnected: false,
          qrCode: this.latestQR,
        };
      } else {
        return {
          status: "connecting",
          message: "Connecting to WhatsApp...",
          isConnected: false,
          qrCode: null,
        };
      }
    } else if (this.latestQR) {
      return {
        status: "qr_ready",
        message: "QR code ready. Please scan it.",
        isConnected: false,
        qrCode: this.latestQR,
      };
    } else {
      return {
        status: "connecting",
        message: "Connecting to WhatsApp...",
        isConnected: false,
        qrCode: null,
      };
    }
  }

  async handleMessage(msg: any, type: string, sock: WASocket) {
    if (!msg.key.remoteJid?.endsWith("@g.us")) {
      return; // Not a group message
    }

    try {
      // Get group metadata to check the group name
      const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
      const groupName = groupMetadata.subject;

      console.log(
        `📝 Group: "${groupName}" (${msg.key.remoteJid}), Type: ${type}`
      );

      // Check if this is a target group (check both group ID and group name for backward compatibility)
      const isTargetGroup = this.targetGroups.some(
        (target) =>
          target === msg.key.remoteJid ||
          groupName.toLowerCase() === target.toLowerCase()
      );

      if (!isTargetGroup) {
        console.log(`❌ Group "${groupName}" not in target list - skipping`);
        return;
      }

      const isHistorical = type === "append";
      const messageType = isHistorical ? "HISTORICAL" : "NEW";

      console.log(`✅ ${messageType} message from target group "${groupName}"`);

      // Safely serialize the message content to avoid JSON serialization issues
      const serializedMessage = this.serializeMessage(msg.message);

      // Extract plain text from message for efficient searching
      const messageText = this.extractMessageText(msg.message);

      const messageData: WhatsAppMessage = {
        user_id: this.userId, // Store messages for this specific user
        timestamp: new Date(
          (Number(msg.messageTimestamp) || Date.now() / 1000) * 1000
        ).toISOString(),
        group_id: msg.key.remoteJid,
        group_name: groupName,
        sender: msg.key.participant || "unknown",
        message_text: messageText,
        message_meta: serializedMessage,
      };

      // Store in Supabase for ALL users to access
      try {
        console.log("🔍 Attempting to store message:", {
          user_id: messageData.user_id,
          group_name: messageData.group_name,
          sender: messageData.sender,
          message_text:
            messageText.substring(0, 50) +
            (messageText.length > 50 ? "..." : ""),
          messageKeys: Object.keys(messageData),
        });

        const { data, error } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert([messageData])
          .select();

        if (error) {
          console.error("Failed to store message in Supabase:", error);
          console.error("Error details:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          // Fall back to file logging
          this.logToFile(messageData, messageType);
        } else {
          console.log(`💾 Message stored in Supabase:`, data[0]?.id);
        }
      } catch (error) {
        console.error("Failed to store message in Supabase:", error);
        // Fall back to file logging
        this.logToFile(messageData, messageType);
      }

      // Always log to console
      console.log(
        `[${messageType}] [${messageData.timestamp}] [${messageData.group_name}] [${messageData.sender}]: ${messageText}`
      );
    } catch (error) {
      console.error(
        `Failed to process message from ${msg.key.remoteJid}:`,
        error
      );
    }
  }

  private logToFile(messageData: WhatsAppMessage, messageType: string) {
    const logEntry = {
      ...messageData,
      messageType: messageType.toLowerCase(),
    };

    // Append message to a file as fallback
    fs.appendFileSync("group_messages.log", JSON.stringify(logEntry) + "\n");
  }

  updateTargetGroups(groups: string[]) {
    this.targetGroups = groups;
    console.log(`🎯 Target groups updated:`, this.targetGroups);
  }

  getTargetGroups(): string[] {
    return [...this.targetGroups];
  }

  async cleanup(): Promise<void> {
    try {
      if (this.sock) {
        console.log("🧹 Cleaning up WhatsApp connection...");
        // Remove specific event listeners
        this.sock.ev.removeAllListeners("messages.upsert");
        this.sock.ev.removeAllListeners("connection.update");
        this.sock.ev.removeAllListeners("creds.update");
        this.sock = undefined;
      }

      // Save final state
      this.isConnected = false;
      this.saveStateToFile();

      console.log("✅ WhatsApp service cleanup completed");
    } catch (error) {
      console.error("Error during WhatsApp cleanup:", error);
    }
  }

  private serializeMessage(message: any): any {
    if (!message) return null;

    try {
      // Convert the message object to JSON and back to remove any non-serializable properties
      // This handles Uint8Array and other problematic types
      return JSON.parse(
        JSON.stringify(message, (key, value) => {
          // Handle Uint8Array and other special types
          if (value instanceof Uint8Array) {
            return Array.from(value);
          }
          // Handle other potential problematic types
          if (typeof value === "bigint") {
            return value.toString();
          }
          return value;
        })
      );
    } catch (error) {
      console.warn("Failed to serialize message, using fallback:", error);
      // Fallback: extract just the text content if possible
      if (message.conversation) {
        return { conversation: message.conversation };
      }
      if (message.extendedTextMessage?.text) {
        return { text: message.extendedTextMessage.text };
      }
      return { error: "Failed to serialize message", type: typeof message };
    }
  }

  // Extract plain text from WhatsApp message object
  private extractMessageText(message: any): string {
    if (!message) return "[Empty Message]";

    try {
      // Simple conversation messages
      if (message.conversation) {
        return message.conversation;
      }

      // Extended text messages
      if (message.extendedTextMessage?.text) {
        return message.extendedTextMessage.text;
      }

      // Image messages with captions
      if (message.imageMessage?.caption) {
        return `[Image] ${message.imageMessage.caption}`;
      }

      // Video messages with captions
      if (message.videoMessage?.caption) {
        return `[Video] ${message.videoMessage.caption}`;
      }

      // Document messages
      if (message.documentMessage?.fileName) {
        return `[Document] ${message.documentMessage.fileName}`;
      }

      // Audio messages
      if (message.audioMessage) {
        return "[Audio Message]";
      }

      // Image messages without captions
      if (message.imageMessage) {
        return "[Image]";
      }

      // Video messages without captions
      if (message.videoMessage) {
        return "[Video]";
      }

      // Contact messages
      if (message.contactMessage?.displayName) {
        return `[Contact] ${message.contactMessage.displayName}`;
      }

      // Location messages
      if (message.locationMessage) {
        return "[Location]";
      }

      // Sticker messages
      if (message.stickerMessage) {
        return "[Sticker]";
      }

      // Reaction messages
      if (message.reactionMessage) {
        return `[Reaction] ${message.reactionMessage.text || "👍"}`;
      }

      // Poll messages
      if (message.pollCreationMessage) {
        return `[Poll] ${message.pollCreationMessage.name || "Poll"}`;
      }

      // Default fallback
      return "[Unknown Message Type]";
    } catch (error) {
      console.warn("Failed to extract message text:", error);
      return "[Error extracting message]";
    }
  }

  // Load user group preferences from database
  private async loadUserGroupPreferences() {
    try {
      const { data, error } = await supabaseAdmin
        .from("user_group_preferences")
        .select("group_id, group_name")
        .eq("user_id", this.userId)
        .eq("is_enabled", true);

      if (error) {
        console.warn(
          `Failed to load group preferences for user ${this.userId}:`,
          error
        );
        // Fall back to default groups if database query fails
        this.targetGroups = ["test", "Real Estate Connect"];
        return;
      }

      if (data && data.length > 0) {
        // Store group IDs for efficient matching
        this.targetGroups = data.map((row) => row.group_id);
        console.log(
          `📂 Loaded ${this.targetGroups.length} target groups for user ${this.userId}:`,
          data.map((row) => `${row.group_name} (${row.group_id})`)
        );
      } else {
        // No preferences set yet, use default groups (these will be group names until user sets preferences)
        this.targetGroups = ["test", "Real Estate Connect"];
        console.log(
          `📂 No group preferences found for user ${this.userId}, using defaults:`,
          this.targetGroups
        );
      }
    } catch (error) {
      console.error(
        `Error loading group preferences for user ${this.userId}:`,
        error
      );
      // Fall back to default groups
      this.targetGroups = ["test", "Real Estate Connect"];
    }
  }

  // Get available groups that the user can select from (based on their WhatsApp groups)
  async getAvailableGroups(): Promise<
    { group_id: string; group_name: string }[]
  > {
    if (!this.sock || !this.isConnected) {
      throw new Error("WhatsApp not connected");
    }

    try {
      // Get all groups the user is part of
      const groups = await this.sock.groupFetchAllParticipating();

      return Object.keys(groups).map((groupId) => ({
        group_id: groupId,
        group_name: groups[groupId].subject || "Unknown Group",
      }));
    } catch (error) {
      console.error("Error fetching available groups:", error);
      throw error;
    }
  }

  // Get user's current group preferences
  async getUserGroupPreferences(): Promise<
    { group_id: string; group_name: string; is_enabled: boolean }[]
  > {
    try {
      const { data, error } = await supabaseAdmin
        .from("user_group_preferences")
        .select("group_id, group_name, is_enabled")
        .eq("user_id", this.userId);

      if (error) {
        console.error("Error fetching user group preferences:", error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error("Error fetching user group preferences:", error);
      return [];
    }
  }

  // Update user group preferences
  async updateUserGroupPreferences(
    preferences: { group_id: string; group_name: string; is_enabled: boolean }[]
  ): Promise<void> {
    try {
      // Delete existing preferences for this user
      await supabaseAdmin
        .from("user_group_preferences")
        .delete()
        .eq("user_id", this.userId);

      // Insert new preferences
      const insertData = preferences.map((pref) => ({
        user_id: this.userId,
        group_id: pref.group_id,
        group_name: pref.group_name,
        is_enabled: pref.is_enabled,
      }));

      const { error } = await supabaseAdmin
        .from("user_group_preferences")
        .insert(insertData);

      if (error) {
        throw error;
      }

      // Reload the target groups
      await this.loadUserGroupPreferences();

      console.log(`✅ Updated group preferences for user ${this.userId}`);
    } catch (error) {
      console.error("Error updating user group preferences:", error);
      throw error;
    }
  }
}
