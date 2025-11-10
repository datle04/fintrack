// src/controllers/admin/category.controller.ts
import { Request, Response } from "express";
import Transaction from "../../models/Transaction";
import { AuthRequest } from "../../middlewares/requireAuth"; // Nên dùng AuthRequest vì đây là route admin

export const getCategorySummary = async (req: AuthRequest, res: Response) => {
  try {
    const summary = await Transaction.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          total: {
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $match: {
          $and: [
            { _id: { $ne: null } },
            { _id: { $ne: "" } },
          ],
        },
      },
    ]);

    res.json(summary);
  } catch (error) {
    console.error("❌ Lỗi thống kê danh mục (admin):", error);
    res.status(500).json({ message: "Lỗi server khi thống kê danh mục", error });
  }
};
