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

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type === "notify") {
      for (const msg of messages) {
        if (msg.key.remoteJid?.endsWith("@g.us")) {
          // group message
          const logEntry = {
            timestamp: new Date().toISOString(),
            group: msg.key.remoteJid,
            sender: msg.key.participant,
            message: msg.message,
          };
          // Log to console with timestamp, group, and sender
          console.log(
            `[${logEntry.timestamp}] [${logEntry.group}] [${logEntry.sender}]`,
            msg.message
          );
          // Append message to a file
          fs.appendFileSync(
            "group_messages.log",
            JSON.stringify(logEntry) + "\n"
          );
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

app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
