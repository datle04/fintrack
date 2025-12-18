import { Response } from "express";
import mongoose from "mongoose";
import Notification from "../../models/Notification";
import { logAction } from "../../utils/logAction";
import Budget from "../../models/Budget";
import { AuthRequest } from "../../middlewares/requireAuth";
import { processTransactionData } from "../transaction.controller";
import { createAndSendNotification } from "../../services/notification.service";

// --- Helper Functions (Để format thông báo) ---
const formatVND = (num: number) =>
  (num || 0).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
// ---------------------------------------------

/**
 * Lấy tất cả ngân sách (có phân trang và bộ lọc)
 * GET /admin/budgets?page=1&limit=20&userId=...&month=...&year=...
 */
export const getAllBudgets = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const { userId, month, year } = req.query;
  const filter: any = {};

  if (userId && mongoose.Types.ObjectId.isValid(userId as string)) {
    filter.user = userId; 
  }
  if (month) {
    filter.month = parseInt(month as string); 
  }
  if (year) {
    filter.year = parseInt(year as string); 
  }

  try {
    const budgets = await Budget.find(filter)
      .populate("user", "name email") 
      .sort({ year: -1, month: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Budget.countDocuments(filter);

    res.json({
      budgets,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy tất cả ngân sách (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * Lấy ngân sách theo ID
 * GET /admin/budget/:budgetId
 */
export const getBudgetById = async (req: AuthRequest, res: Response) => {
  const { budgetId } = req.params;

  try {
    const budget = await Budget.findById(budgetId).populate("user", "name email currency");

    if (!budget) {
      res.status(404).json({ message: "Không tìm thấy ngân sách" });
      return;
    }

    res.json(budget);
  } catch (error) {
    console.error("❌ Lỗi khi lấy ngân sách theo ID (admin):", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * Admin xóa ngân sách
 * DELETE /admin/budgets/:budgetId
 */
export const adminDeleteBudget = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body; 

  try {
    const budget = await Budget.findById(id).populate('user', 'name email');
    
    if (!budget) {
      res.status(404).json({ message: "Ngân sách không tồn tại." });
      return;
    }

    await Budget.findByIdAndDelete(id);

    const message = `Admin đã xóa ngân sách tháng ${budget.month}/${budget.year} của bạn.
                     ${reason ? `Lý do: ${reason}` : "Lý do: Vi phạm quy định hệ thống."}
                     Vui lòng tạo lại ngân sách mới nếu cần thiết.`;

    await createAndSendNotification(
        budget.user._id, 
        "info", 
        message, 
        "/budget"
    );

    await logAction(req, {
      action: "Admin Delete Budget",
      statusCode: 200,
      description: `Admin xóa ngân sách ID: ${id}. Lý do: ${reason}`,
      level: "critical",
      metadata: {
        deletedBudget: budget.toObject(), 
        reason: reason
      }
    });

    res.status(200).json({ message: "Đã xóa ngân sách thành công." });

  } catch (error) {
    console.error("❌ Lỗi admin xóa ngân sách:", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};