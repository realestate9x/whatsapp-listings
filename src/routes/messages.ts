import express from "express";
import { jwtMiddleware } from "../middlewares/jwt";
import {
  getMessages,
  getMessagesByGroup,
  getGroupsList,
} from "../controllers/messages-controller";

const router = express.Router();

// Apply JWT middleware to all routes
router.use(jwtMiddleware);

// GET /api/messages - Get all messages for authenticated user
router.get("/", async (req, res, next) => {
  try {
    await getMessages(req, res);
  } catch (error) {
    next(error);
  }
});

// GET /api/messages/groups - Get list of groups for authenticated user
router.get("/groups", async (req, res, next) => {
  try {
    await getGroupsList(req, res);
  } catch (error) {
    next(error);
  }
});

// GET /api/messages/groups/:groupName - Get messages from specific group
router.get("/groups/:groupName", async (req, res, next) => {
  try {
    await getMessagesByGroup(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;
