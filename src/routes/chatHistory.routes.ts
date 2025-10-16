import express from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { saveChatMessage, getChatHistory } from "../controllers/chatHistory.controller";

const router = express.Router();

// GET: lấy toàn bộ lịch sử chat của user
router.get("/", requireAuth, getChatHistory);

// POST: thêm 1 tin nhắn mới (user hoặc bot)
router.post("/", requireAuth, saveChatMessage);

export default router;
