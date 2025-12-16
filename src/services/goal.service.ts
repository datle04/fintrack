// src/services/goal.service.ts
import mongoose from "mongoose";
import Transaction, { ITransaction } from "../models/Transaction";
import Goal from "../models/Goal";

export const updateGoalProgress = async (transaction: ITransaction) => {
    try {
        // Chỉ chạy nếu giao dịch này có liên kết với một mục tiêu
        if (transaction.goalId && transaction.type === 'expense') {
            // Tính toán giá trị cơ sở (VND) của khoản đóng góp này
            // (Giả định exchangeRate đã là tỷ giá quy đổi về VND)
            const baseAmountToAdd = transaction.amount * transaction.exchangeRate;

            if (baseAmountToAdd === 0) return;

            // Tăng (hoặc giảm nếu là số âm) `currentBaseAmount` của Mục tiêu
            await Goal.findByIdAndUpdate(transaction.goalId, {
                $inc: { currentBaseAmount: baseAmountToAdd },
            });
            
            console.log(`[Goal Update] Cập nhật Goal ${transaction.goalId} thêm ${baseAmountToAdd} VND`);
        }
    } catch (error) {
        console.error(`[Goal Update Error] Lỗi khi cập nhật mục tiêu ${transaction.goalId}:`, error);
    }
};

/**
 * Hàm này tính toán lại toàn bộ số tiền của Goal dựa trên
 * tất cả các giao dịch đang tồn tại trong Database.
 * Dùng khi: Xóa giao dịch, Sửa giao dịch, hoặc Admin bấm "Tính toán lại".
 */
export const recalculateGoalProgress = async (goalOrId: any) => {
  try {
    // Logic mềm dẻo: Chấp nhận truyền vào Goal Document hoặc Goal ID
    let goal;
    if (typeof goalOrId === "string" || goalOrId instanceof mongoose.Types.ObjectId) {
      goal = await Goal.findById(goalOrId);
    } else {
      goal = goalOrId;
    }

    if (!goal) {
        console.log("[Goal Service] Không tìm thấy Goal để update.");
        return;
    }

    const goalId = goal._id;

    // 1. Dùng Aggregation tính tổng
    const stats = await Transaction.aggregate([
      {
        $match: {
          goalId: new mongoose.Types.ObjectId(goalId),
        },
      },
      {
        $group: {
          _id: null, // Không cần group theo type nữa, gộp tất cả
          total: {
            // Chỉ cần cộng dồn hết lại (vì gắn GoalId nghĩa là đóng góp)
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
    ]);

    // 2. Lấy kết quả (Nếu không có giao dịch nào thì là 0)
    let newCurrentAmount = stats.length > 0 ? stats[0].total : 0;

    // 3. AN TOÀN TUYỆT ĐỐI: Đảm bảo không bao giờ âm
    newCurrentAmount = Math.max(0, newCurrentAmount);

    // 4. Cập nhật field
    goal.currentBaseAmount = newCurrentAmount;

    // 5. Cập nhật trạng thái
    // Sử dụng targetBaseAmount (Backend tự tính) thay vì targetOriginalAmount để so sánh chuẩn xác
    const target = goal.targetBaseAmount || goal.targetOriginalAmount; 
    const now = new Date();
    const deadline = goal.targetDate ? new Date(goal.targetDate) : null;

    // Logic trạng thái
    if (goal.currentBaseAmount >= target) {
      goal.status = "completed";
    } else if (deadline && deadline < now) {
      // Chỉ failed nếu quá hạn MÀ chưa hoàn thành
      goal.status = "failed"; 
    } else {
      goal.status = "in_progress";
    }

    // Quan trọng: Chỉ save các trường cần thiết để tránh validate lại cả document
    // Tuy nhiên goal.save() là cách dễ nhất, nhưng cần đảm bảo Schema Goal chuẩn.
    await goal.save();
    
    console.log(`[Goal Service] Recalculated Goal ${goalId}: ${newCurrentAmount} VND - Status: ${goal.status}`);
    
  } catch (error) {
    console.error(`[Goal Service Error] Lỗi tính toán lại Goal:`, error);
  }
};