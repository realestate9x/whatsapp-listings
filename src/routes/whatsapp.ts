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

export default router;
