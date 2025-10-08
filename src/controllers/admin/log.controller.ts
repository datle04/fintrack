import Log from "../../models/Log";
import { Request, Response } from "express";

export const getLogs = async (req: Request, res: Response) => {
  try {
    const { action, method, level, page = 1, limit = 50, startDate, endDate, } = req.query;

    const query: any = {};

    // Lọc theo action, method, level như cũ
    if (action) query.action = { $regex: action, $options: "i" };
    if (method) query.method = method.toString().toUpperCase();
    if (level) query.level = level;

    // Lọc theo khoảng thời gian
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate.toString());
      if (endDate) query.timestamp.$lte = new Date(endDate.toString());
    }

    const skip = (Number(page) - 1) * Number(limit);

    const total = await Log.countDocuments(query);
    const logs = await Log.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      logs,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalLogs: total,
    });
  } catch (err) {
    console.error("❌ Error in getLogs:", err);
    res.status(500).json({ message: "Lỗi server khi lấy logs!" });
  }
};

