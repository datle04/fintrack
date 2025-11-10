// src/controllers/admin/goal.controller.ts
import { Response } from "express";
import mongoose from "mongoose";
import Goal from "../../models/Goal"; //
import Transaction from "../../models/Transaction"; //
import { AuthRequest } from "../../middlewares/requireAuth"; //
import { logAction } from "../../utils/logAction"; //
import Notification from "../../models/Notification";

// --- Helper Function (Lấy từ goal.controller.ts của user) ---
//
// Hàm này nên được chuyển ra file service riêng (ví dụ: src/services/goalService.ts)
// để cả admin và user controller đều có thể dùng chung.
const updateGoalProgress = async (goal: any) => {
  const goalId = goal._id;

  // 1. Tính tổng tiền đã "gửi" vào mục tiêu (loại 'saving')
  const savingResult = await Transaction.aggregate([
    {
      $match: {
        goalId: new mongoose.Types.ObjectId(goalId),
        type: "saving",
      },
    },
    {
      $group: {
        _id: null,
        totalSavings: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
  ]);

  // 2. Tính tổng tiền đã "rút" khỏi mục tiêu (loại 'expense')
  const expenseResult = await Transaction.aggregate([
    {
      $match: {
        goalId: new mongoose.Types.ObjectId(goalId),
        type: "expense",
      },
    },
    {
      $group: {
        _id: null,
        totalExpenses: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
  ]);

  const totalSavings = savingResult[0]?.totalSavings || 0;
  const totalExpenses = expenseResult[0]?.totalExpenses || 0;

  // 3. Cập nhật currentAmount
  goal.currentAmount = totalSavings - totalExpenses;

  // 4. Cập nhật status
  if (goal.currentAmount >= goal.targetAmount) {
    goal.status = "completed";
  } else if (goal.deadline && new Date(goal.deadline) < new Date()) {
    goal.status = "failed";
  } else {
    goal.status = "in_progress";
  }

  await goal.save();
  console.log(`[GoalService] Đã cập nhật tiến độ cho Goal ID: ${goalId}`);
};
// --- Kết thúc Helper Function ---

/**
 * [MỚI] Lấy tất cả mục tiêu (có phân trang)
 * GET /admin/goals
 */
export const getAllGoals = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const goals = await Goal.find()
      .populate("userId", "name email") // Liên kết đến model User
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Goal.countDocuments();

    res.json({
      goals,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy tất cả mục tiêu (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [MỚI] Lấy mục tiêu theo ID
 * GET /admin/goals/:goalId
 */
export const getGoalById = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;

  try {
    const goal = await Goal.findById(goalId).populate("user", "name email");

    if (!goal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    res.json(goal);
  } catch (error) {
    console.error("❌ Lỗi khi lấy mục tiêu theo ID (admin):", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * [MỚI] Admin cập nhật mục tiêu
 * PUT /admin/goals/:goalId
 */
export const adminUpdateGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;
  // 1. Lấy "reason" và các trường dữ liệu từ body
  const { reason, ...updateData } = req.body;

  try {
    // 2. Tìm mục tiêu GỐC để so sánh
    const originalGoal = await Goal.findById(goalId);
    if (!originalGoal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    // 3. Cập nhật mục tiêu
    const updatedGoal = await Goal.findByIdAndUpdate(goalId, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedGoal) {
      // (Trường hợp hiếm gặp)
      res.status(404).json({ message: "Không tìm thấy mục tiêu sau khi cập nhật" });
      return;
    }

    // 4. So sánh và tạo thông điệp thay đổi
    const changes: string[] = [];
    if (originalGoal.name !== updatedGoal.name) {
      changes.push(`Tên từ "${originalGoal.name}" thành "${updatedGoal.name}"`);
    }
    if (originalGoal.targetOriginalAmount !== updatedGoal.targetOriginalAmount) { //
      changes.push(`Số tiền mục tiêu từ ${originalGoal.targetOriginalAmount} thành ${updatedGoal.targetOriginalAmount}`);
    }
    if (originalGoal.currentBaseAmount !== updatedGoal.currentBaseAmount) { //
      changes.push(`Số tiền hiện tại từ ${originalGoal.currentBaseAmount} thành ${updatedGoal.currentBaseAmount} (sửa thủ công)`);
    }
    if (originalGoal.targetDate !== updatedGoal.targetDate) { //
      changes.push(`Hạn chót từ ${originalGoal.targetDate} thành ${updatedGoal.targetDate}`);
    }

    // 5. Gửi thông báo (nếu có thay đổi)
    if (changes.length > 0) {
      const message = `Một quản trị viên đã cập nhật mục tiêu "<b>${originalGoal.name}</b>" của bạn.
                       <br/><b>Các thay đổi:</b> ${changes.join(", ")}.
                       ${reason ? `<br/><b>Lý do:</b> ${reason}` : ""}`;
                       
      await Notification.create({
        user: updatedGoal.userId, //
        type: "admin_action",
        message: message,
      });
    }

    // 6. Ghi Log
    await logAction(req, {
      action: "Admin Update Goal",
      statusCode: 200,
      description: `Admin đã cập nhật mục tiêu ID: ${goalId}. Lý do: ${reason || "Không có"}. Thay đổi: ${changes.join(", ") || "Không có"}`,
    });

    res.json(updatedGoal);
  } catch (error) {
    console.error("❌ Lỗi khi admin cập nhật mục tiêu:", error);
    await logAction(req, {
      action: "Admin Update Goal",
      statusCode: 500,
      description: `Lỗi khi cập nhật mục tiêu ID: ${goalId}. Lý do: ${reason || "Không có"}`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * [MỚI] Admin xóa mục tiêu
 * DELETE /admin/goals/:goalId
 */
export const adminDeleteGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;
  const { reason } = req.body; // <-- 1. LẤY LÝ DO TỪ BODY

  try {
    // 2. Tìm và xóa mục tiêu
    const deletedGoal = await Goal.findByIdAndDelete(goalId);

    if (!deletedGoal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    // --- 3. GỬI THÔNG BÁO CHO NGƯỜI DÙNG ---
    const message = `Một quản trị viên đã xóa mục tiêu của bạn: "${deletedGoal.name}".
                     ${reason ? `Lý do: ${reason}` : ""}`;
                     
    await Notification.create({
      user: deletedGoal.userId, // Gửi đến user sở hữu mục tiêu
      type: "admin_action",
      message: message,
    });
    // ------------------------------------

    // 4. Gỡ bỏ goalId khỏi tất cả các giao dịch liên quan (Giữ nguyên)
    await Transaction.updateMany(
      { goalId: deletedGoal._id },
      { $unset: { goalId: "" } } // Xóa trường goalId
    );

    // 5. Ghi Log (Cập nhật lý do)
    await logAction(req, {
      action: "Admin Delete Goal",
      statusCode: 200,
      description: `Admin đã xóa mục tiêu ID: ${goalId} (Tên: ${deletedGoal.name}) của user ${deletedGoal.userId}. Lý do: ${reason || "Không có"}`,
    });

    res.json({ message: "Đã xóa mục tiêu thành công" });
  } catch (error) {
    console.error("❌ Lỗi khi admin xóa mục tiêu:", error);
    await logAction(req, {
      action: "Admin Delete Goal",
      statusCode: 500,
      description: `Lỗi khi xóa mục tiêu ID: ${goalId}. Lý do: ${reason || "Không có"}`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * [MỚI] Admin tính toán lại tiến độ mục tiêu
 * POST /admin/goals/:goalId/recalculate
 */
export const adminRecalculateGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;

  try {
    const goal = await Goal.findById(goalId);
    if (!goal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    // Gọi hàm helper để tính toán lại
    await updateGoalProgress(goal);

    await logAction(req, {
      action: "Admin Recalculate Goal",
      statusCode: 200,
      description: `Admin đã tính toán lại tiến độ mục tiêu ID: ${goalId}`,
    });

    res.json({ message: "Đã tính toán lại tiến độ thành công", goal });
  } catch (error) {
    console.error("❌ Lỗi khi admin tính toán lại mục tiêu:", error);
    await logAction(req, {
      action: "Admin Recalculate Goal",
      statusCode: 500,
      description: `Lỗi khi tính toán lại mục tiêu ID: ${goalId}`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};