import {
  WASocket,
  fetchLatestBaileysVersion,
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  AuthenticationState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import { supabaseAdmin, WhatsAppMessage } from "../lib/supabase";
import { PropertyMessageFilter } from "../utils/property-filter";
import { useSupabaseAuthState } from "../utils/supabase-auth-state";
import logger from "../lib/logger";
import fs from "fs";
import crypto from "crypto";

export class WhatsAppService {
  private targetGroups: string[] = []; // Will be loaded from database
  private sock: WASocket | undefined;
  private latestQR: string | null = null;
  private connectionState: "close" | "connecting" | "open" = "close";
  private isAuthenticated: boolean = false;
  private userId: string;
  private onLogoutCallback?: () => void;
  private msgRetryCounterCache: NodeCache;
  private authState: AuthenticationState | undefined;
  private isInitializing: boolean = false;

  constructor(userId: string) {
    this.userId = userId;
    this.msgRetryCounterCache = new NodeCache();

    // Load user preferences async (don't await in constructor)
    this.loadUserGroupPreferences().catch((error) => {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Failed to load user group preferences in constructor"
      );
    });
  }

  // Improved connection management following Baileys best practices
  async startConnection(): Promise<void> {
    if (this.isInitializing) {
      logger.info({ userId: this.userId }, "Already initializing connection");
      return;
    }

    this.isInitializing = true;

    try {
      const { state, saveCreds } = await useSupabaseAuthState(this.userId);

      this.authState = state;
      const { version, isLatest } = await fetchLatestBaileysVersion();

      logger.info(
        {
          userId: this.userId,
          waVersion: version.join("."),
          isLatest,
        },
        "Starting WhatsApp connection"
      );

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys),
        },
        msgRetryCounterCache: this.msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        browser: ["Ubuntu", "Chrome", "22.04.4"],
        syncFullHistory: false, // More efficient for property listening
      });

      // Use the recommended event processing pattern from Baileys
      this.sock.ev.process(async (events) => {
        // Handle connection updates
        if (events["connection.update"]) {
          await this.handleConnectionUpdate(events["connection.update"]);
        }

        // Handle credential updates
        if (events["creds.update"]) {
          try {
            await saveCreds();
          } catch (error) {
            logger.error(
              {
                userId: this.userId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Failed to save credentials"
            );
            // Don't throw here as it would break the event processing
            // The connection can continue to work even if saving fails temporarily
          }
        }

        // Handle message upserts
        if (events["messages.upsert"]) {
          await this.handleMessageUpsert(events["messages.upsert"]);
        }

        // Handle message updates (delivery, read receipts, etc.)
        if (events["messages.update"]) {
          // Optional: Handle message status updates
          logger.debug(
            {
              userId: this.userId,
              messageCount: events["messages.update"].length,
            },
            "Messages updated"
          );
        }

        // Handle group updates
        if (events["groups.update"]) {
          logger.debug(
            {
              userId: this.userId,
              groupCount: events["groups.update"].length,
            },
            "Groups updated"
          );
        }
      });
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Failed to start WhatsApp connection"
      );
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  private async handleConnectionUpdate(update: any) {
    const { connection, lastDisconnect, qr } = update;

    logger.info(
      {
        userId: this.userId,
        connection,
        hasQr: !!qr,
      },
      "WhatsApp connection update"
    );

    if (qr) {
      logger.info(
        {
          userId: this.userId,
        },
        "QR Code generated, access via /status endpoint"
      );
      this.latestQR = qr;
      this.connectionState = "connecting";
    }

    if (connection === "close") {
      this.connectionState = "close";
      this.isAuthenticated = false;
      logger.warn(
        {
          userId: this.userId,
        },
        "WhatsApp connection closed"
      );

      const disconnectError = lastDisconnect?.error;
      if (disconnectError) {
        logger.error(
          {
            userId: this.userId,
            error: disconnectError,
          },
          "Connection closed due to error"
        );

        // Check if it's a logout or other permanent disconnect
        const statusCode = (disconnectError as Boom)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          logger.info(
            {
              userId: this.userId,
            },
            "User logged out, cleaning up auth data"
          );
          await this.handleLogout();
          this.notifyLogout();
        } else if (statusCode === 440) {
          // Handle conflict/replaced error - another device took over the session
          logger.warn(
            {
              userId: this.userId,
              statusCode,
              error: disconnectError,
            },
            "WhatsApp session replaced by another device/connection"
          );

          // Clear auth data since the session is no longer valid
          await this.handleLogout();
          this.notifyLogout();
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          // Handle connection replaced scenario
          logger.warn(
            {
              userId: this.userId,
              statusCode,
            },
            "WhatsApp connection replaced, clearing auth data"
          );

          await this.handleLogout();
          this.notifyLogout();
        } else {
          // For other disconnect reasons, attempt to reconnect
          logger.info(
            {
              userId: this.userId,
              statusCode,
            },
            "Attempting to reconnect"
          );
          setTimeout(() => {
            this.startConnection().catch((error) => {
              logger.error(
                {
                  userId: this.userId,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to reconnect"
              );
            });
          }, 3000); // Simple 3-second delay instead of complex exponential backoff
        }
      }
    }

    if (connection === "connecting") {
      this.connectionState = "connecting";
      logger.info(
        {
          userId: this.userId,
        },
        "Connecting to WhatsApp"
      );
    }

    if (connection === "open") {
      this.connectionState = "open";
      this.isAuthenticated = true;
      this.latestQR = null;
      logger.info(
        {
          userId: this.userId,
        },
        "WhatsApp connected successfully, listening for messages"
      );

      // Reload user preferences when connection is established
      this.loadUserGroupPreferences().catch((error) => {
        logger.error(
          {
            userId: this.userId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to load user group preferences"
        );
      });
    }
  }

  private async handleMessageUpsert(upsert: any) {
    const { messages, type } = upsert;

    logger.debug(
      {
        userId: this.userId,
        messageType: type,
        messageCount: messages.length,
      },
      "Message upsert received"
    );

    if (type === "notify" || type === "append") {
      for (const msg of messages) {
        if (this.sock) {
          await this.handleMessage(msg, type, this.sock);
        }
      }
    }
  }

  // Auto-initialize connection on startup if auth exists
  async autoStartIfPossible(): Promise<boolean> {
    try {
      // Check if we have existing auth credentials in Supabase for this user
      const { data, error } = await supabaseAdmin
        .from("whatsapp_auth_creds")
        .select("id")
        .eq("user_id", this.userId)
        .single();

      if (data && !error) {
        logger.info(
          {
            userId: this.userId,
          },
          "Found existing WhatsApp auth, attempting auto-connection"
        );
        await this.startConnection();
        return true;
      } else {
        logger.info(
          {
            userId: this.userId,
          },
          "No existing WhatsApp auth found, manual connection required"
        );
        return false;
      }
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to auto-start WhatsApp connection"
      );
      return false;
    }
  }

  getConnectionStatus() {
    const isConnected = this.connectionState === "open" && this.isAuthenticated;

    return {
      isConnected,
      qrCode: this.latestQR,
      socketActive: !!this.sock,
      connectionState: this.connectionState,
      isAuthenticated: this.isAuthenticated,
      status: isConnected
        ? "connected"
        : this.latestQR
        ? "qr_ready"
        : this.connectionState === "connecting"
        ? "connecting"
        : "disconnected",
      message: isConnected
        ? "WhatsApp is connected"
        : this.latestQR
        ? "QR code ready"
        : this.connectionState === "connecting"
        ? "Connecting to WhatsApp..."
        : "Not connected",
    };
  }

  async initializeIfNeeded(): Promise<{
    status: string;
    message: string;
    isConnected: boolean;
    qrCode: string | null;
  }> {
    const isConnected = this.connectionState === "open" && this.isAuthenticated;

    if (isConnected) {
      return {
        status: "connected",
        message: "WhatsApp is connected",
        isConnected: true,
        qrCode: null,
      };
    }

    if (!this.sock && !this.isInitializing) {
      await this.startConnection();
      // Wait a moment for QR to be generated or connection to establish
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (this.latestQR) {
        return {
          status: "qr_ready",
          message: "QR code ready. Please scan it.",
          isConnected: false,
          qrCode: this.latestQR,
        };
      } else if (this.connectionState === "open") {
        return {
          status: "connected",
          message: "WhatsApp is connected",
          isConnected: true,
          qrCode: null,
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
        status:
          this.connectionState === "connecting" ? "connecting" : "disconnected",
        message:
          this.connectionState === "connecting"
            ? "Connecting to WhatsApp..."
            : "Not connected",
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

      logger.debug(
        {
          userId: this.userId,
          groupName,
          groupId: msg.key.remoteJid,
          messageType: type,
        },
        "Processing group message"
      );

      // Check if this is a target group (check both group ID and group name for backward compatibility)
      const isTargetGroup = this.targetGroups.some(
        (target) =>
          target === msg.key.remoteJid ||
          groupName.toLowerCase() === target.toLowerCase()
      );

      if (!isTargetGroup) {
        logger.debug(
          {
            userId: this.userId,
            groupName,
            targetGroups: this.targetGroups,
          },
          "Group not in target list, skipping"
        );
        return;
      }

      const isHistorical = type === "append";
      const messageType = isHistorical ? "HISTORICAL" : "NEW";

      logger.info(
        {
          userId: this.userId,
          groupName,
          messageType,
        },
        "Processing message from target group"
      );

      // Safely serialize the message content to avoid JSON serialization issues
      const serializedMessage = this.serializeMessage(msg.message);

      // Extract plain text from message for efficient searching
      const messageText = this.extractMessageText(msg.message);

      // Filter message to check if it's a property listing
      const filterResult = PropertyMessageFilter.filterMessage(messageText);

      logger.debug(
        {
          userId: this.userId,
          isPropertyListing: filterResult.isPropertyListing,
          confidence: filterResult.confidence,
          matchedKeywords: filterResult.matchedKeywords.length,
          matchedPatterns: filterResult.matchedPatterns.length,
        },
        "Property filter result"
      );

      // Only store property listings in the database
      if (!filterResult.isPropertyListing) {
        logger.debug(
          {
            userId: this.userId,
            reason: filterResult.reason,
          },
          "Skipping non-property message"
        );
        return;
      }

      logger.info(
        {
          userId: this.userId,
          confidence: filterResult.confidence,
          matchedKeywords: filterResult.matchedKeywords.slice(0, 3),
          matchedPatterns: filterResult.matchedPatterns,
        },
        "Storing property message"
      );

      // Create a hash to identify duplicate messages
      const messageHash = this.createMessageHash(
        messageText,
        msg.key.participant || "unknown"
      );

      // Check if this message already exists for this user
      const existingMessage = await this.checkForDuplicateMessage(
        messageHash,
        this.userId
      );

      if (existingMessage) {
        logger.info(
          {
            userId: this.userId,
            existingGroupName: existingMessage.group_name,
          },
          "Duplicate message detected, skipping"
        );
        return;
      }

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
        message_hash: messageHash,
      };

      // Store in Supabase for ALL users to access
      try {
        logger.info(
          {
            userId: messageData.user_id,
            groupName: messageData.group_name,
            sender: messageData.sender,
            messagePreview:
              messageText.substring(0, 50) +
              (messageText.length > 50 ? "..." : ""),
            filterConfidence: filterResult.confidence,
            matchedKeywords: filterResult.matchedKeywords.length,
            matchedPatterns: filterResult.matchedPatterns.length,
          },
          "Storing property message in database"
        );

        const { data, error } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert([messageData])
          .select();

        if (error) {
          logger.error(
            {
              userId: this.userId,
              error: {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
              },
            },
            "Failed to store message in Supabase"
          );
          // Fall back to file logging
          this.logToFile(messageData, messageType);
        } else {
          logger.info(
            {
              userId: this.userId,
              messageId: data[0]?.id,
            },
            "Message stored in Supabase successfully"
          );
        }
      } catch (error) {
        logger.error(
          {
            userId: this.userId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to store message in Supabase"
        );
        // Fall back to file logging
        this.logToFile(messageData, messageType);
      }

      // Log the property message details
      logger.info(
        {
          userId: this.userId,
          messageType,
          timestamp: messageData.timestamp,
          groupName: messageData.group_name,
          sender: messageData.sender,
          messageText:
            messageText.substring(0, 100) +
            (messageText.length > 100 ? "..." : ""),
          confidence: Math.round(filterResult.confidence * 100),
        },
        "Property message processed"
      );
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          groupId: msg.key.remoteJid,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to process message"
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
    logger.info(
      {
        userId: this.userId,
        targetGroups: this.targetGroups,
      },
      "Target groups updated"
    );
  }

  getTargetGroups(): string[] {
    return [...this.targetGroups];
  }

  async cleanup(): Promise<void> {
    try {
      if (this.sock) {
        logger.info(
          {
            userId: this.userId,
          },
          "Cleaning up WhatsApp connection"
        );
        // The new event system automatically handles cleanup
        // No need to manually remove listeners as we're using sock.ev.process()
        this.sock = undefined;
      }

      // Reset state
      this.connectionState = "close";
      this.isAuthenticated = false;

      logger.info(
        {
          userId: this.userId,
        },
        "WhatsApp service cleanup completed"
      );
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error during WhatsApp cleanup"
      );
    }
  }

  async handleLogout(): Promise<void> {
    try {
      logger.info(
        {
          userId: this.userId,
        },
        "Handling logout, cleaning up auth data"
      );

      // Clean up socket connection
      await this.cleanup();

      // Remove auth data from Supabase
      const { error: credsError } = await supabaseAdmin
        .from("whatsapp_auth_creds")
        .delete()
        .eq("user_id", this.userId);

      if (credsError) {
        logger.warn(
          {
            userId: this.userId,
            error: credsError,
          },
          "Failed to delete credentials"
        );
      } else {
        logger.info(
          {
            userId: this.userId,
          },
          "Removed auth credentials"
        );
      }

      const { error: keysError } = await supabaseAdmin
        .from("whatsapp_auth_keys")
        .delete()
        .eq("user_id", this.userId);

      if (keysError) {
        logger.warn(
          {
            userId: this.userId,
            error: keysError,
          },
          "Failed to delete keys"
        );
      } else {
        logger.info(
          {
            userId: this.userId,
          },
          "Removed auth keys"
        );
      }

      // Reset internal state
      this.connectionState = "close";
      this.isAuthenticated = false;
      this.latestQR = null;
      this.targetGroups = [];
      this.authState = undefined;

      logger.info(
        {
          userId: this.userId,
        },
        "Logout cleanup completed"
      );
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error during logout cleanup"
      );
    }
  }

  setLogoutCallback(callback: () => void): void {
    this.onLogoutCallback = callback;
  }

  private notifyLogout(): void {
    if (this.onLogoutCallback) {
      this.onLogoutCallback();
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
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageType: typeof message,
        },
        "Failed to serialize message, using fallback"
      );
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
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to extract message text"
      );
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
        logger.warn(
          {
            userId: this.userId,
            error,
          },
          "Failed to load group preferences, using defaults"
        );
        // Fall back to default groups if database query fails
        this.targetGroups = ["test", "Real Estate Connect"];
        return;
      }

      if (data && data.length > 0) {
        // Store group IDs for efficient matching
        this.targetGroups = data.map((row) => row.group_id);
        logger.info(
          {
            userId: this.userId,
            groupCount: this.targetGroups.length,
            groups: data.map((row) => ({
              name: row.group_name,
              id: row.group_id,
            })),
          },
          "Loaded target groups for user"
        );
      } else {
        // No preferences set yet, use default groups (these will be group names until user sets preferences)
        this.targetGroups = ["test", "Real Estate Connect"];
        logger.info(
          {
            userId: this.userId,
            targetGroups: this.targetGroups,
          },
          "No group preferences found, using defaults"
        );
      }
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error loading group preferences, using defaults"
      );
      // Fall back to default groups
      this.targetGroups = ["test", "Real Estate Connect"];
    }
  }

  // Get available groups that the user can select from (based on their WhatsApp groups)
  async getAvailableGroups(): Promise<
    { group_id: string; group_name: string }[]
  > {
    if (!this.sock || this.connectionState !== "open") {
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
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error fetching available groups"
      );
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
        logger.error(
          {
            userId: this.userId,
            error,
          },
          "Error fetching user group preferences"
        );
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error fetching user group preferences"
      );
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

      logger.info(
        {
          userId: this.userId,
          preferenceCount: preferences.length,
        },
        "Updated group preferences"
      );
    } catch (error) {
      logger.error(
        {
          userId: this.userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error updating user group preferences"
      );
      throw error;
    }
  }

  // Create a hash for message deduplication
  private createMessageHash(messageText: string, sender: string): string {
    // Normalize the message text by removing extra whitespace and converting to lowercase
    const normalizedText = messageText
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    // Create a hash from just the normalized text and sender
    // This ensures the same message from the same sender will have the same hash regardless of which group it appears in
    const hashInput = `${normalizedText}|${sender}`;

    return crypto.createHash("sha256").update(hashInput).digest("hex");
  }

  // Check if a message with the same hash already exists for this user
  private async checkForDuplicateMessage(
    messageHash: string,
    userId: string
  ): Promise<any | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id, group_name")
        .eq("user_id", userId)
        .eq("message_hash", messageHash)
        .limit(1);

      if (error) {
        logger.error(
          {
            userId,
            error,
          },
          "Error checking for duplicate message"
        );
        return null;
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      logger.error(
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error checking for duplicate message"
      );
      return null;
    }
  }
}
