// src/controllers/admin/log.controller.ts
import { Request, Response } from "express";
import Log from "../../models/Log"; //
import { AuthRequest } from "../../middlewares/requireAuth"; //
import mongoose from "mongoose";

export const getAllLogs = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Bộ lọc (Filters)
  const { level, action, method, startDate, endDate, userId } = req.query; // <-- 1. LẤY THÊM userId TỪ QUERY

  const filter: any = {};

  if (level) {
    filter.level = level;
  }
  if (action) {
    filter.action = { $regex: action, $options: "i" }; // Tìm kiếm không phân biệt hoa thường
  }
  if (method) {
    filter.method = method;
  }

  // --- 2. THÊM LOGIC LỌC THEO USERID ---
  if (userId) {
    // Đảm bảo userId là một ObjectId hợp lệ trước khi lọc
    if (mongoose.Types.ObjectId.isValid(userId as string)) {
      filter.userId = userId; //
    } else {
      res.status(400).json({ message: "UserId không hợp lệ" });
      return;
    }
  }
  // ------------------------------------

  if (startDate && endDate) {
    filter.timestamp = {
      $gte: new Date(startDate as string),
      $lte: new Date(endDate as string),
    };
  } else if (startDate) {
    filter.timestamp = { $gte: new Date(startDate as string) };
  } else if (endDate) {
    filter.timestamp = { $lte: new Date(endDate as string) };
  }

  try {
    const logs = await Log.find(filter)
      .populate("user", "name email") //
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Log.countDocuments(filter);

    res.json({
      logs,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy tất cả log (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const getLogStats = async (req: AuthRequest, res: Response) => {
  try {
    const totalLogs = await Log.countDocuments();
    const errorLogs = await Log.countDocuments({ level: "error" });
    const infoLogs = await Log.countDocuments({ level: "info" });

    const recentErrors = await Log.find({ level: "error" })
      .sort({ timestamp: -1 })
      .limit(5)
      .populate("user", "name email");

    res.json({
      totalLogs,
      errorLogs,
      infoLogs,
      recentErrors,
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy thống kê log (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};