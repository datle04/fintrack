import { Request, Response } from 'express';
import axios from 'axios';

export const chatProxy = async (req: Request, res: Response) => {
  try {
    // 1. Lấy tin nhắn từ Frontend gửi lên
    const { message, history } = req.body;

    // 2. Lấy URL của Chatbot từ biến môi trường
    // Render cung cấp biến này dạng "chatbot-service:10000" (nếu bạn dùng hostport trong yaml)
    // Code này sẽ tự thêm http:// nếu thiếu
    let chatbotUrl = process.env.CHATBOT_URL || 'http://localhost:4001';
    if (!chatbotUrl.startsWith('http')) {
      chatbotUrl = `http://${chatbotUrl}`;
    }

    // 3. Gọi sang Chatbot (Server-to-Server)
    // Lúc này không cần gửi cookie, vì Chatbot sẽ tin tưởng Backend
    const response = await axios.post(`${chatbotUrl}/chat`, {
      message,
      history
    });

    // 4. Trả kết quả từ Chatbot về lại cho Frontend
    res.status(200).json(response.data);
    return;

  } catch (error: any) {
    console.error("Lỗi Proxy Chatbot:", error);
    // Xử lý lỗi nếu Chatbot bị sập hoặc trả về lỗi
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
      return;
    }
    res.status(500).json({ message: "Không thể kết nối đến Chatbot Service" });
    return;
  }
};