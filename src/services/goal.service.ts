import mongoose from "mongoose";
import Transaction, { ITransaction } from "../models/Transaction";
import Goal from "../models/Goal";

export const updateGoalProgress = async (transaction: ITransaction) => {
    try {
        if (transaction.goalId && transaction.type === 'expense') {
            const baseAmountToAdd = transaction.amount * transaction.exchangeRate;

            if (baseAmountToAdd === 0) return;

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

    const stats = await Transaction.aggregate([
      {
        $match: {
          goalId: new mongoose.Types.ObjectId(goalId),
        },
      },
      {
        $group: {
          _id: null, 
          total: {
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
    ]);

    let newCurrentAmount = stats.length > 0 ? stats[0].total : 0;

    newCurrentAmount = Math.max(0, newCurrentAmount);

    goal.currentBaseAmount = newCurrentAmount;

    const target = goal.targetBaseAmount || goal.targetOriginalAmount; 
    const now = new Date();
    const deadline = goal.targetDate ? new Date(goal.targetDate) : null;

    if (goal.currentBaseAmount >= target) {
      goal.status = "completed";
    } else if (deadline && deadline < now) {
      goal.status = "failed"; 
    } else {
      goal.status = "in_progress";
    }

    await goal.save();
    
    console.log(`[Goal Service] Recalculated Goal ${goalId}: ${newCurrentAmount} VND - Status: ${goal.status}`);
    
  } catch (error) {
    console.error(`[Goal Service Error] Lỗi tính toán lại Goal:`, error);
  }
};