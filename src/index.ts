import express, { Request, Response } from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import messagesRouter from "./routes/messages";
import whatsappRouter from "./routes/whatsapp";
import parsingJobRouter from "./routes/parsing-job";
import { errorHandler } from "./middlewares/error-handler";
import { WhatsAppServiceManager } from "./services/whatsapp-service-manager";
import { jwtMiddleware } from "./middlewares/jwt";

// Load environment variables
dotenv.config();

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

// Enable CORS for frontend
app.use(
  cors({
    origin: [
      "https://realestateli.netlify.app",
      "https://realestateli.netlify.app/",
      "http://localhost:8080",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Add body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Initialize WhatsApp service manager for multi-user support
const whatsappServiceManager = new WhatsAppServiceManager();

// Make the service manager available to routes via app.locals
app.locals.whatsappServiceManager = whatsappServiceManager;

// Define direct endpoints before API routes
// User-specific WhatsApp status - requires authentication
app.get("/my-whatsapp-status", jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
      return;
    }

    let userService = whatsappServiceManager.getExistingService(userId);

    // If no service exists, create one and try to auto-start
    if (!userService) {
      userService = whatsappServiceManager.getServiceForUser(userId);
      // Give it a moment to attempt auto-start
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const status = userService.getConnectionStatus();
    res.json({
      connected: status.isConnected,
      qr_pending: !!status.qrCode,
      socket_active: status.socketActive,
      user_id: userId,
      ...status,
    });
  } catch (error) {
    console.error("Error getting user WhatsApp status:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get user WhatsApp status",
    });
  }
});

// Show QR code status - requires authentication
app.get("/start-whatsapp", jwtMiddleware, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({
        status: "error",
        message: "User not authenticated",
        isConnected: false,
        qrCode: null,
      });
      return;
    }

    const userService = whatsappServiceManager.getServiceForUser(userId);
    const result = await userService.initializeIfNeeded();
    res.json(result);
  } catch (error) {
    console.error("Error starting WhatsApp:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to start WhatsApp connection",
      isConnected: false,
      qrCode: null,
    });
  }
});

// Check WhatsApp connection status - public endpoint with limited info
app.get("/status", (req, res) => {
  try {
    const allStatuses = whatsappServiceManager.getAllServicesStatus();
    const activeServices = Object.values(allStatuses).filter(
      (status: any) => status.isConnected
    ).length;
    const totalServices = Object.keys(allStatuses).length;

    res.json({
      connected: activeServices > 0,
      qr_pending: Object.values(allStatuses).some(
        (status: any) => status.qrCode
      ),
      socket_active: activeServices > 0,
      isConnected: activeServices > 0,
      qrCode: null, // Don't expose QR codes in public endpoint
      status: activeServices > 0 ? "connected" : "disconnected",
      message: `Multi-user WhatsApp service: ${activeServices}/${totalServices} connections active`,
      active_connections: activeServices,
      total_services: totalServices,
    });
  } catch (error) {
    console.error("Error getting WhatsApp status:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get WhatsApp status",
    });
  }
});

// API Routes
app.use("/api/messages", messagesRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/parsing-job", parsingJobRouter);

// Admin endpoint to view all WhatsApp services status (for debugging)
app.get("/admin/whatsapp-services", (req, res) => {
  try {
    const allStatuses = whatsappServiceManager.getAllServicesStatus();
    const serviceCount = Object.keys(allStatuses).length;

    res.json({
      total_services: serviceCount,
      services: allStatuses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting all services status:", error);
    res.status(500).json({
      error: "Failed to get services status",
    });
  }
});

// Add error handling middleware
app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`Express server running on http://localhost:${PORT}`);
  console.log(`🚀 Multi-user WhatsApp service manager initialized`);
  console.log(
    `💡 Users can connect their WhatsApp via /start-whatsapp endpoint`
  );
});

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  await whatsappServiceManager.cleanupAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  await whatsappServiceManager.cleanupAll();
  process.exit(0);
});
