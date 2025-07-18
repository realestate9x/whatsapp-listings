import express from "express";
import { jwtMiddleware } from "../middlewares/jwt";
import { WhatsAppServiceManager } from "../services/whatsapp-service-manager";
import logger from "../lib/logger";

const router = express.Router();

// Public endpoint for general WhatsApp service status (no auth required)
router.get("/public-status", (req, res, next) => {
  (async () => {
    try {
      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      const allStatuses = serviceManager.getAllServicesStatus();
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
      next(error);
    }
  })();
});

// Apply JWT middleware to all routes below this point
router.use(jwtMiddleware);

// GET /api/whatsapp/status - Get WhatsApp connection status for this user
router.get("/status", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      let userService = serviceManager.getExistingService(userId);

      // If no service exists, create one and try to auto-start
      if (!userService) {
        userService = serviceManager.getServiceForUser(userId);
        // Give it a moment to attempt auto-start
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const status = userService.getConnectionStatus();
      res.json({
        success: true,
        connected: status.isConnected,
        qr_pending: !!status.qrCode,
        socket_active: status.socketActive,
        ...status,
        user_id: userId,
        note: "Use /connect to initialize connection if not connected",
      });
    } catch (error) {
      next(error);
    }
  })();
});

// POST /api/whatsapp/connect - Connect/initialize WhatsApp for this user
router.post("/connect", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: "User not authenticated",
          status: "error",
          isConnected: false,
          qrCode: null,
        });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      const userService = serviceManager.getServiceForUser(userId);
      const result = await userService.initializeIfNeeded();

      res.json({
        success: true,
        user_id: userId,
        ...result,
      });
    } catch (error) {
      logger.error(
        {
          userId: req.user?.sub,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error connecting WhatsApp"
      );
      res.status(500).json({
        success: false,
        status: "error",
        message: "Failed to start WhatsApp connection",
        isConnected: false,
        qrCode: null,
      });
    }
  })();
});

// POST /api/whatsapp/disconnect - Disconnect user's WhatsApp
router.post("/disconnect", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      await serviceManager.removeUserService(userId);

      res.json({
        success: true,
        message: "WhatsApp connection disconnected successfully",
        user_id: userId,
      });
    } catch (error) {
      next(error);
    }
  })();
});

// POST /api/whatsapp/force-logout - Force logout and cleanup auth data
router.post("/force-logout", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      await serviceManager.handleUserLogout(userId);

      res.json({
        success: true,
        message: "WhatsApp logout and cleanup completed successfully",
        user_id: userId,
      });
    } catch (error) {
      next(error);
    }
  })();
});

// GET /api/whatsapp/groups - Get available WhatsApp groups for the user
router.get("/groups", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      const userService = serviceManager.getServiceForUser(userId);

      // Check if the service is connected
      const status = userService.getConnectionStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          error: "WhatsApp not connected. Please connect first.",
          status: status.status,
          qr_pending: !!status.qrCode,
          note: "Use /connect to initialize connection",
        });
      }

      const availableGroups = await userService.getAvailableGroups();
      const userPreferences = await userService.getUserGroupPreferences();

      // Merge available groups with user preferences
      const groupsWithPreferences = availableGroups.map((group) => {
        const preference = userPreferences.find(
          (p) => p.group_id === group.group_id
        );
        return {
          ...group,
          is_enabled: preference ? preference.is_enabled : false,
        };
      });

      res.json({
        success: true,
        groups: groupsWithPreferences,
        user_id: userId,
      });
    } catch (error) {
      // Check if it's a connection error from getAvailableGroups
      if (
        error instanceof Error &&
        error.message === "WhatsApp not connected"
      ) {
        return res.status(400).json({
          error: "WhatsApp connection lost. Please reconnect.",
          status: "disconnected",
          note: "Use /connect to re-establish connection",
        });
      }

      logger.error(
        {
          userId: req.user?.sub,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error fetching WhatsApp groups"
      );

      res.status(500).json({
        error: "Failed to fetch WhatsApp groups",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

// PUT /api/whatsapp/groups - Update user's group monitoring preferences
router.put("/groups", (req, res, next) => {
  (async () => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { preferences } = req.body;
      if (!Array.isArray(preferences)) {
        return res.status(400).json({
          error: "Invalid request body. Expected 'preferences' array.",
        });
      }

      const serviceManager = req.app.locals
        .whatsappServiceManager as WhatsAppServiceManager;
      const userService = serviceManager.getServiceForUser(userId);

      // Check if the service is connected
      const status = userService.getConnectionStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          error: "WhatsApp not connected. Please connect first.",
          status: status.status,
          qr_pending: !!status.qrCode,
          note: "Use /connect to initialize connection",
        });
      }

      await userService.updateUserGroupPreferences(preferences);

      res.json({
        success: true,
        message: "Group preferences updated successfully",
        user_id: userId,
      });
    } catch (error) {
      logger.error(
        {
          userId: req.user?.sub,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error updating group preferences"
      );

      res.status(500).json({
        error: "Failed to update group preferences",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

export default router;
