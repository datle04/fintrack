
import express from "express";
import { requireAuth } from '../middlewares/requireAuth';
import { chatProxy } from "../controllers/chatProxy.controller";

// ... các route khác ...
const router = express.Router();

// ROUTE MỚI: Dùng verifyUser để bảo vệ, user phải đăng nhập mới chat được
// Frontend sẽ gọi vào đây thay vì gọi trực tiếp Chatbot
router.post('/', requireAuth, chatProxy);

export default router;