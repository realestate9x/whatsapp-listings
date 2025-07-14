import express from "express";
import { jwtMiddleware } from "../middlewares/jwt";
import { WhatsAppServiceManager } from "../services/whatsapp-service-manager";

const router = express.Router();

// Apply JWT middleware to all routes
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
      const userService = serviceManager.getExistingService(userId);

      if (!userService) {
        return res.json({
          success: false,
          connected: false,
          message: "No WhatsApp connection for this user",
          user_id: userId,
          note: "Use /start-whatsapp endpoint to initialize connection",
        });
      }

      const status = userService.getConnectionStatus();
      res.json({
        success: true,
        connected: status.isConnected,
        ...status,
        user_id: userId,
        note: "Use /api/messages endpoints to retrieve your messages",
      });
    } catch (error) {
      next(error);
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
      const userService = serviceManager.getExistingService(userId);

      if (!userService) {
        return res.status(400).json({
          error: "WhatsApp not connected. Please connect first.",
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
      next(error);
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
      const userService = serviceManager.getExistingService(userId);

      if (!userService) {
        return res.status(400).json({
          error: "WhatsApp not connected. Please connect first.",
        });
      }

      await userService.updateUserGroupPreferences(preferences);

      res.json({
        success: true,
        message: "Group preferences updated successfully",
        user_id: userId,
      });
    } catch (error) {
      next(error);
    }
  })();
});

export default router;
