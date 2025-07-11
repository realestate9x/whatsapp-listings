import express, { Request, Response } from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import messagesRouter from "./routes/messages";
import whatsappRouter from "./routes/whatsapp";
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
    origin: "https://realestateli.netlify.app/",
    credentials: true,
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

// API Routes
app.use("/api/messages", messagesRouter);
app.use("/api/whatsapp", whatsappRouter);

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

// User-specific WhatsApp status - requires authentication
app.get("/my-whatsapp-status", jwtMiddleware, (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
      return;
    }

    const userService = whatsappServiceManager.getExistingService(userId);
    if (!userService) {
      res.json({
        connected: false,
        qr_pending: false,
        socket_active: false,
        isConnected: false,
        qrCode: null,
        status: "disconnected",
        message: "No WhatsApp service initialized for this user",
        user_id: userId,
      });
      return;
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

// =============================================================================
// AUTHENTICATION ENDPOINTS (for development and testing)
// =============================================================================

// Simple login endpoint - generates JWT token
app.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Simple validation (in production, check against database)
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // For demo purposes, accept any email/password combination
    // In production, validate against your database
    const userId = `user-${email.replace(/[^a-zA-Z0-9]/g, '')}`;
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({
      iss: "realestate-app",
      sub: userId,
      aud: "authenticated",
      email: email,
      role: "user",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      is_anonymous: false,
    }, process.env.JWT_SECRET || 'your-secret-key');

    return res.json({
      success: true,
      token: token,
      user: {
        id: userId,
        email: email,
        role: "user"
      },
      message: "Login successful"
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

// Get test token endpoint (for development)
app.get("/get-test-token", (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const testUser = {
      iss: "realestate-app",
      sub: "test-user-12345",
      aud: "authenticated",
      email: "test@example.com",
      role: "user",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      is_anonymous: false,
    };

    const token = jwt.sign(testUser, process.env.JWT_SECRET || 'your-secret-key');
    
    return res.json({
      token: token,
      user: testUser,
      usage: {
        description: "Use this token in Authorization header as 'Bearer <token>'",
        curl_example: `curl -H "Authorization: Bearer ${token}" http://localhost:3000/start-whatsapp`,
        browser_example: "Add 'Authorization: Bearer <token>' header to your requests"
      }
    });
  } catch (error) {
    console.error("Error generating test token:", error);
    return res.status(500).json({ error: "Failed to generate test token" });
  }
});

// Test WhatsApp endpoint without authentication (for quick testing)
app.get("/test-whatsapp", async (req: Request, res: Response) => {
  try {
    console.log("🧪 Test WhatsApp endpoint accessed (no auth required)");
    
    const testUserId = "test-user-12345";
    const userService = whatsappServiceManager.getServiceForUser(testUserId);
    const result = await userService.initializeIfNeeded();
    
    return res.json({
      ...result,
      user_id: testUserId,
      note: "This is a test endpoint - use /start-whatsapp with proper authentication for production"
    });
  } catch (error) {
    console.error("Error in test WhatsApp endpoint:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to start test WhatsApp connection",
      isConnected: false,
      qrCode: null,
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
