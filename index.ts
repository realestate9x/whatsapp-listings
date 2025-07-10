import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
} from "@whiskeysockets/baileys";
import fs from "fs";
import qrcode from "qrcode-terminal";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase: any = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized');
} else {
  console.log('⚠️  Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env file');
}

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: true,
      messageFormat: "{req.method} {req.url} {res.statusCode} {responseTime}ms",
      ignore: "pid,hostname,req,res,responseTime",
    },
  },
});
const app = express();
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");
app.use(
  pinoHttp({
    logger,
    customLogLevel: function (res, err) {
      const status = res.statusCode ?? 0;
      // Only treat as error if status is 500+ or err is an actual Error object
      if (status >= 500 || (err && err instanceof Error)) return "error";
      return "info";
    },
    serializers: {
      req(req) {
        return { method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    autoLogging: true,
  })
);
const PORT = 3000;

let sock: WASocket | undefined;
let latestQR: string | null = null;
let isConnected: boolean = false;

// Function to save message to Supabase
async function saveMessageToSupabase(logEntry: any) {
  if (!supabase) {
    console.log('Supabase not configured, skipping database save');
    return;
  }

  try {
    // Extract message text from the message object
    let messageText = '';
    if (logEntry.message?.conversation) {
      messageText = logEntry.message.conversation;
    } else if (logEntry.message?.extendedTextMessage?.text) {
      messageText = logEntry.message.extendedTextMessage.text;
    } else if (logEntry.message?.imageMessage?.caption) {
      messageText = logEntry.message.imageMessage.caption;
    } else if (logEntry.message?.videoMessage?.caption) {
      messageText = logEntry.message.videoMessage.caption;
    } else {
      // Fallback for other message types
      messageText = JSON.stringify(logEntry.message);
    }

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .insert([
        {
          timestamp: logEntry.timestamp,
          group_id: logEntry.group,
          group_name: logEntry.groupName,
          sender: logEntry.sender,
          message_text: messageText,
          message_content: logEntry.message,
          status: logEntry.messageType === 'historical' ? 'historical' : 'unprocessed'
        }
      ]);

    if (error) {
      console.error('Error saving to Supabase:', error);
    } else {
      console.log('💾 Message saved to Supabase database');
    }
  } catch (error) {
    console.error('Error connecting to Supabase:', error);
  }
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    syncFullHistory: true,
    browser: ["Ubuntu", "Chrome", "22.04.4"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`📨 Message upsert type: ${type}, count: ${messages.length}`);
    
    if (type === "notify" || type === "append") {
      for (const msg of messages) {
        if (msg.key.remoteJid?.endsWith("@g.us")) {
          // group message
          try {
            // Get group metadata to check the group name
            if (!sock) return;
            const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
            const groupName = groupMetadata.subject;
            
            console.log(`📝 Group: "${groupName}", Type: ${type}`);
            
            // Target groups - add more group names here as needed
            const targetGroups = ["test", "Real Estate Connect"];
            const isTargetGroup = targetGroups.some(target => 
              groupName.toLowerCase() === target.toLowerCase()
            );
            
            // Only log messages if group name matches target groups
            if (isTargetGroup) {
              const isHistorical = type === "append";
              const messageType = isHistorical ? "HISTORICAL" : "NEW";
              
              console.log(`✅ ${messageType} message from target group "${groupName}"`);
              
              const logEntry = {
                timestamp: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
                group: msg.key.remoteJid,
                groupName: groupName,
                sender: msg.key.participant,
                message: msg.message,
                messageType: messageType.toLowerCase(),
              };
              
              // Log to console with timestamp, group, and sender
              console.log(
                `[${messageType}] [${logEntry.timestamp}] [${logEntry.groupName}] [${logEntry.sender}]`,
                msg.message
              );
              
              // Append message to a file
              fs.appendFileSync(
                "group_messages.log",
                JSON.stringify(logEntry) + "\n"
              );
              
              // Save message to Supabase
              await saveMessageToSupabase(logEntry);
            } else {
              console.log(`❌ Group "${groupName}" not in target list - skipping`);
            }
          } catch (error) {
            console.error(`Failed to get group metadata for ${msg.key.remoteJid}:`, error);
          }
        }
      }
    }
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // Print QR code as ASCII in terminal
      qrcode.generate(qr, { small: true });
      latestQR = qr;
    }
    if (connection === "close") {
      isConnected = false;
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) {
        startSock();
      }
    }
    // Clear QR if connected
    if (connection === "open") {
      isConnected = true;
      latestQR = null;
    }
  });
}

// Show QR code in browser for new users, or connection status
app.get("/start-whatsapp", async (req, res) => {
  if (isConnected) {
    res.render("connected");
    return;
  }
  if (!sock) {
    await startSock();
    // Wait a moment for QR to be generated
    setTimeout(() => {
      if (latestQR) {
        res.render("qr", { qr: latestQR });
      } else {
        res.render("qr", { qr: null });
      }
    }, 1000);
  } else if (latestQR) {
    res.render("qr", { qr: latestQR });
  } else {
    res.render("qr", { qr: null });
  }
});
// Render a page that lists all groups in cards
app.get("/groups-page", (req, res) => {
  res.render("groups");
});

// Endpoint to get all WhatsApp groups

app.get("/groups", async (req, res) => {
  if (!sock) {
    res.status(400).send("WhatsApp is not connected.");
    return;
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    // groups is an object with group JIDs as keys and group metadata as values
    const groupList = Object.values(groups).map((group: any) => ({
      id: group.id,
      name: group.subject,
      participants: group.participants.length,
    }));
    res.json(groupList);
  } catch (err) {
    res.status(500).send("Failed to fetch groups.");
  }
});

// Fetch last 20 messages for a group, including from WhatsApp if possible
app.get("/group/:jid/messages", async (req, res) => {
  const { jid } = req.params;
  try {
    // Read the log file and filter messages for the group
    let fileMessages: any[] = [];
    try {
      fileMessages = fs
        .readFileSync("group_messages.log", "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry: any) => entry.group === jid);
    } catch {}

    // Fetch last 20 messages from WhatsApp directly (if connected)
    let waMessages: any[] = [];
    if (
      sock &&
      isConnected &&
      typeof (sock as any).fetchMessagesFromWA === "function"
    ) {
      try {
        // Fetch last 20 messages from WhatsApp
        const result = await (sock as any).fetchMessagesFromWA(jid, 20);
        waMessages = result.map((msg: any) => ({
          timestamp: new Date((msg.messageTimestamp || 0) * 1000).toISOString(),
          group: jid,
          sender: msg.key.participant,
          message: msg.message,
          fromHistory: true,
        }));
      } catch (err) {
        // Ignore if cannot fetch from WhatsApp
      }
    }

    // Merge and deduplicate by message ID (if available)
    const allMessages = [...fileMessages, ...waMessages];
    // Optionally deduplicate by message key id
    const seen = new Set();
    const deduped = allMessages.filter((msg: any) => {
      const id =
        msg.message?.id || msg.message?.key?.id || msg.timestamp + msg.sender;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    // Sort by timestamp ascending
    deduped.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    // Return the last 20 messages (most recent last)
    res.json(deduped.slice(-20));
  } catch (err) {
    res.status(500).send("Failed to fetch messages for this group.");
  }
});

// New endpoint: Fetch messages from Supabase database
app.get("/api/messages", async (req, res) => {
  if (!supabase) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const { 
      group_name = 'test',
      limit = '50',
      offset = '0',
      start_date,
      end_date 
    } = req.query;

    let query = supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('group_name', group_name)
      .order('timestamp', { ascending: false })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    // Add date filtering if provided
    if (start_date) {
      query = query.gte('timestamp', start_date);
    }
    if (end_date) {
      query = query.lte('timestamp', end_date);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching from Supabase:', error);
      res.status(500).json({ error: 'Failed to fetch messages from database' });
      return;
    }

    res.json({
      messages: data || [],
      total: count,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (err) {
    console.error('Database query error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// New endpoint: Get message statistics
app.get("/api/stats", async (req, res) => {
  if (!supabase) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const { data: totalCount } = await supabase
      .from('whatsapp_messages')
      .select('*', { count: 'exact', head: true });

    const { data: testGroupCount } = await supabase
      .from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .eq('group_name', 'test');

    const { data: recentMessages } = await supabase
      .from('whatsapp_messages')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1);

    res.json({
      total_messages: totalCount || 0,
      test_group_messages: testGroupCount || 0,
      last_message_time: recentMessages?.[0]?.timestamp || null
    });
  } catch (err) {
    console.error('Stats query error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
