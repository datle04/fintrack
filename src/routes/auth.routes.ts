import { Router } from 'express';
import { login, register } from '../controllers/auth.controller';
import { logActivity } from '../middlewares/logActivity';
import express from "express";
import jwt from "jsonwebtoken";
import UserModel from "../models/User";

const router = Router();

router.use(logActivity);

router.post("/register", register);
router.post("/login", login);
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

export default router;