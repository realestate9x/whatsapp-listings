import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import logger from "./lib/logger";
import pinoHttp from "pino-http";
import { errorHandler } from "./middlewares/error-handler";
import messagesRouter from "./routes/messages";
import parsingJobRouter from "./routes/parsing-job";
import whatsappRouter from "./routes/whatsapp";
import { RealEstateParsingJob } from "./services/real-estate-job";
import { WhatsAppServiceManager } from "./services/whatsapp-service-manager";

// Load environment variables
dotenv.config();

const app = express();

// Health check endpoint to prevent sleeping
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV || "development",
  });
});

// Enable CORS for frontend
app.use(
  cors({
    origin: [
      "https://realestateli.netlify.app",
      "https://6871598a62471100087cf31a--realestateli.netlify.app",
      "http://localhost:8080",
      "http://localhost:5173",
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
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "Error getting all services status"
    );
    res.status(500).json({
      error: "Failed to get services status",
    });
  }
});

// Add error handling middleware
app.use(errorHandler);

app.listen(PORT, async () => {
  logger.info(
    {
      port: PORT,
      nodeEnv: process.env.NODE_ENV || "development",
    },
    "Express server started"
  );

  logger.info("Multi-user WhatsApp service manager initialized");
  logger.info(
    "Users can connect their WhatsApp via POST /api/whatsapp/connect"
  );

  // Auto-start the parsing job when server starts
  try {
    const parsingJob = new RealEstateParsingJob(logger);
    await parsingJob.startRecurringJob(5); // 5 minute interval
    logger.info(
      {
        intervalMinutes: 5,
      },
      "Real estate parsing job started automatically"
    );
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to auto-start parsing job"
    );
  }

  // Self-ping mechanism to prevent Render.com sleeping (only in production)
  if (process.env.NODE_ENV === "production" && process.env.RENDER_SERVICE_URL) {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-min sleep threshold)

    setInterval(async () => {
      try {
        const response = await fetch(
          `${process.env.RENDER_SERVICE_URL}/health`
        );
        if (response.ok) {
          logger.debug(
            {
              timestamp: new Date().toISOString(),
            },
            "Self-ping successful"
          );
        } else {
          logger.warn(
            {
              status: response.status,
            },
            "Self-ping failed"
          );
        }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "Self-ping error"
        );
      }
    }, PING_INTERVAL);

    logger.info(
      {
        intervalMinutes: 14,
      },
      "Self-ping mechanism started"
    );
  }
});

// Graceful shutdown handling
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  await whatsappServiceManager.cleanupAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await whatsappServiceManager.cleanupAll();
  process.exit(0);
});
