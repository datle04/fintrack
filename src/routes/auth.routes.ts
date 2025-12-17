import e, { Router } from 'express';
import { forgotPassword, login, logout, refreshToken, register, requestChangePassword, resetPassword, verifyAndChangePassword } from '../controllers/auth.controller';
import { logActivity } from '../middlewares/logActivity';
import express from "express";
import jwt from "jsonwebtoken";
import UserModel from "../models/User";
import { requireAuth } from '../middlewares/requireAuth';
import validate from '../middlewares/validate';
import { loginSchema, registerSchema } from '../validations/auth.validation';
import { emailLimiter, loginLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.use(logActivity);

router.post("/register", validate(registerSchema) ,register);
router.post("/login", loginLimiter, validate(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token){
        res.status(400).json({ message: "Missing token" });
        return;
    } 

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
    const user = await UserModel.findById(decoded.id).select("-password");
    if (!user){
        res.status(404).json({ message: "User not found" });
        return;
    }  
    res.json({ valid: true, user });
    
  } catch {
    res.status(401).json({ valid: false, message: "Invalid token" });
    return;
  }
});

// Dành cho người quên mật khẩu, người lạ
router.post("/forgot-password", emailLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

// --- NHÓM 2: PRIVATE (Cần đăng nhập) ---
// Dành cho người dùng đang sử dụng App muốn đổi pass
// Bước 1: Gửi pass cũ -> Nhận OTP
router.post("/change-password/request", requireAuth, requestChangePassword); 
// Bước 2: Gửi OTP + Pass mới -> Đổi xong
router.post("/change-password/verify", requireAuth, verifyAndChangePassword);

export default router;