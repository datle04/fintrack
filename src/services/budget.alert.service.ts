import { Types } from "mongoose";
import Budget from "../models/Budget";
import { createAndSendNotification } from "./notification.service";

/**
 * Helper: Xác định mức độ cảnh báo dựa trên phần trăm chi tiêu.
 * @param percent Phần trăm đã chi (0 - >100)
 * @returns Mức cảnh báo (0, 80, 90, 100)
 */
export const getThresholdLevel = (percent: number): number => {
  if (percent >= 100) return 100;
  if (percent >= 90) return 90;
  if (percent >= 80) return 80;
  return 0;
};

/**
 * Helper: Gửi thông báo (nếu cần) VÀ cập nhật alertLevel vào DB.
 * Hàm này xử lý cả việc TĂNG mức (báo động) và GIẢM mức (reset âm thầm).
 */
export const updateAlertLevelAndNotify = async (
  userId: string | Types.ObjectId,
  budgetId: Types.ObjectId,
  newLevel: number,
  oldLevel: number,
  isCategory: boolean,
  categoryName: string = "",
  message: string = ""
): Promise<void> => {
  try {
    if (newLevel > oldLevel) {
      if (isCategory) {
        await Budget.updateOne(
          { _id: budgetId, "categories.category": categoryName },
          { $set: { "categories.$.alertLevel": newLevel } }
        );
      } else {
        await Budget.findByIdAndUpdate(budgetId, { alertLevel: newLevel });
      }

      const type = isCategory ? "budget_category_warning" : "budget_warning";
      
      await createAndSendNotification(
        userId,
        type,
        message,
        "/budget" 
      );

      console.log(`📢 [Budget Alert] Đã báo mức ${newLevel}% cho User ${userId} (${isCategory ? categoryName : "Tổng"})`);
    } 

    else if (newLevel < oldLevel) {
      if (isCategory) {
        await Budget.updateOne(
          { _id: budgetId, "categories.category": categoryName },
          { $set: { "categories.$.alertLevel": newLevel } }
        );
      } else {
        await Budget.findByIdAndUpdate(budgetId, { alertLevel: newLevel });
      }
      console.log(`📉 [Budget Reset] Hạ mức từ ${oldLevel}% xuống ${newLevel}% cho User ${userId}`);
    }

  } catch (error) {
    console.error("❌ Lỗi khi cập nhật ngân sách/gửi thông báo:", error);
  }
};