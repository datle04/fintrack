import { Request, Response } from "express";
import ChatHistory from "../models/ChatHistory";
import { AuthRequest } from "../middlewares/requireAuth";

export const saveChatMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { role, text } = req.body;
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    let chat = await ChatHistory.findOne({ user: userId });

    // Nếu chưa có lịch sử chat thì tạo mới
    if (!chat) {
      chat = new ChatHistory({
        user: userId,
        messages: [{ role, text }],
      });
    } else {
      chat.messages.push({ role, text });
    }

    await chat.save();
    res.status(200).json({ message: "Saved", chat });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi lưu chat" });
  }
};

export const getChatHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const chat = await ChatHistory.findOne({ user: userId });
    res.status(200).json(chat || { messages: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi lấy lịch sử chat" });
  }
};
