import express from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { saveChatMessage, getChatHistory } from "../controllers/chatHistory.controller";

const router = express.Router();

router.get("/", requireAuth, getChatHistory);

router.post("/", requireAuth, saveChatMessage);

export default router;
