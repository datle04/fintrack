// src/controllers/admin/goal.controller.ts
import { Response } from "express";
import mongoose from "mongoose";
import Goal from "../../models/Goal"; //
import Transaction from "../../models/Transaction"; //
import { AuthRequest } from "../../middlewares/requireAuth"; //
import { logAction } from "../../utils/logAction"; //
import Notification from "../../models/Notification";
import { createAndSendNotification } from "../../services/notification.service";
import { recalculateGoalProgress } from "../../services/goal.service";


export const getAllGoals = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const goals = await Goal.find()
      .populate("userId", "name email") 
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


export const adminUpdateGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;

  console.log(req.body);

  const { 
    name, 
    description, 
    reason 
  } = req.body;

  try {
    // Validate Reason
    if (!reason || reason.trim().length === 0) {
        res.status(400).json({ message: "Admin bắt buộc phải nhập lý do chỉnh sửa." });
        return;
    }

    const originalGoal = await Goal.findById(goalId);
    if (!originalGoal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    const changes: string[] = [];
    
    if (name && originalGoal.name !== name) {
      changes.push(`Tên mục tiêu (từ "${originalGoal.name}" thành "${name}")`);
    }
    
    const oldDesc = originalGoal.description || "";
    const newDesc = description || "";
    if (oldDesc !== newDesc) {
      changes.push(`Mô tả (từ "${oldDesc}" thành "${newDesc}")`);
    }

    if (changes.length === 0) {
        res.status(200).json({ message: "Không có thay đổi nào về thông tin chung." });
        return;
    }

    const updatedGoal = await Goal.findByIdAndUpdate(
        goalId, 
        { 
            $set: { 
                name: name, 
                description: description 
            } 
        }, 
        { new: true, runValidators: true }
    );

    const message = `Một quản trị viên đã cập nhật thông tin mục tiêu "${originalGoal.name}".
                     Thay đổi: ${changes.join(", ")}.
                     Lý do: ${reason}`;
                     
    await createAndSendNotification(
      originalGoal.userId, 
      "info",
      message,
      "/goal"
    );

    await logAction(req, {
      action: "Admin Update Goal",
      statusCode: 200,
      description: `Admin cập nhật metadata mục tiêu ID: ${goalId}. Lý do: ${reason}`,
      metadata: {
        targetId: goalId,
        reason: reason,
        changes: changes,
        // Lưu lại snapshot dữ liệu gốc quan trọng để đối chứng
        snapshot: {
            name: originalGoal.name,
            amount: originalGoal.targetOriginalAmount,
            status: originalGoal.status
        }
      }
    });

    res.json(updatedGoal);

  } catch (error) {
    console.error("❌ Lỗi khi admin cập nhật mục tiêu:", error);
    await logAction(req, {
      action: "Admin Update Goal",
      statusCode: 500,
      description: "Lỗi server khi cập nhật mục tiêu",
      level: "error",
      metadata: { error }
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};

export const adminDeleteGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;
  const { reason } = req.body; 

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!reason || reason.trim().length === 0) {
        await session.abortTransaction();
        res.status(400).json({ message: "Admin bắt buộc phải nhập lý do khi xóa." });
        return;
    }

    const goalToDelete = await Goal.findById(goalId).session(session);

    if (!goalToDelete) {
      await session.abortTransaction();
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    await Goal.findByIdAndDelete(goalId).session(session);

    // XỬ LÝ SIDE-EFFECTS (Bảo vệ dữ liệu Transaction)

    await Transaction.updateMany(
        { goalId: goalId },
        { 
            $set: { 
                goalId: null, 
            } 
        }
    ).session(session);

    // Với các Giao dịch định kỳ (Recurring Templates):
    // Phải TẮT chúng đi, nếu không nó sẽ tiếp tục tạo giao dịch rác không có đích đến
    await Transaction.updateMany(
        { goalId: goalId, isRecurring: true, date: null }, // Template
        { 
            $set: { 
                isRecurring: false, 
                goalId: null,
                note: `(Đã tắt định kỳ do Admin xóa mục tiêu. Lý do: ${reason})`
            } 
        }
    ).session(session);

    await session.commitTransaction();

    // 5. GỬI THÔNG BÁO (Sau khi commit thành công)
    const message = `Admin đã xóa mục tiêu: "${goalToDelete.name}".
                     Lý do: ${reason}.
                     Các giao dịch liên quan đã được ngắt kết nối khỏi mục tiêu này.`;
                     
    await createAndSendNotification(
      goalToDelete.userId, 
      "info", 
      message, 
      "/goal"
    );

    // GHI LOG (Kèm Snapshot để khôi phục)
    await logAction(req, {
      action: "Admin Delete Goal",
      statusCode: 200,
      description: `Admin xóa mục tiêu ID: ${goalId}. Lý do: ${reason}`,
      level: "warning",
      metadata: {
        deletedGoal: goalToDelete.toObject(), 
        reason: reason,
        sideEffects: "Unlinked transactions & Stopped recurring"
      }
    });

    res.json({ message: "Đã xóa mục tiêu và xử lý dữ liệu liên quan." });

  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Lỗi khi admin xóa mục tiêu:", error);
    
    await logAction(req, {
      action: "Admin Delete Goal",
      statusCode: 500,
      description: `Lỗi server khi xóa mục tiêu ID ${goalId}`,
      level: "error",
      metadata: { error }
    });
    
    res.status(500).json({ message: "Lỗi server", error });
  } finally {
    session.endSession();
  }
};

export const adminRecalculateGoal = async (req: AuthRequest, res: Response) => {
  const { goalId } = req.params;

  try {
    const goal = await Goal.findById(goalId);
    if (!goal) {
      res.status(404).json({ message: "Không tìm thấy mục tiêu" });
      return;
    }

    // Gọi hàm helper để tính toán lại
    await recalculateGoalProgress(goalId);

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