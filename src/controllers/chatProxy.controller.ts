import { Request, Response } from 'express';
import axios from 'axios';
import { AuthRequest } from '../middlewares/requireAuth';

export const chatProxy = async (req: AuthRequest, res: Response) => {
  try {
    const { message, history } = req.body;
    
    // Lấy thông tin User từ Middleware của Backend
    const userId = req.user?._id || req.userId; 
    
    // Lấy token raw (nếu chatbot cần dùng để gọi ngược lại API khác)
    // Token thường nằm ở header: "Bearer <token>"
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.accessToken;

    let chatbotUrl = process.env.CHATBOT_URL || 'http://localhost:4001';
    if (!chatbotUrl.startsWith('http')) {
      chatbotUrl = `http://${chatbotUrl}`;
    }

    // Gửi Message + UserId + Token sang Chatbot
    const response = await axios.post(`${chatbotUrl}/chat`, {
      message,
      history,
      userId, // <--- Gửi kèm cái này
      token   // <--- Gửi kèm cái này (để chatbotService dùng)
    });

    res.status(200).json(response.data);
    return;

  } catch (error: any) {
    console.error("Lỗi Proxy Chatbot:", error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
      return;
    }
    res.status(500).json({ message: "Lỗi kết nối Chatbot" });
    return;
  }
};