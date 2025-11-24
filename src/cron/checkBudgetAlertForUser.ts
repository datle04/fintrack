import dayjs from 'dayjs';
import Budget from '../models/Budget';
import Transaction, { ITransaction } from '../models/Transaction'; // Import ITransaction
import Notification from '../models/Notification';
import { Types } from 'mongoose';
import { createAndSendNotification } from '../services/notification.service';

// [Helper] Gửi thông báo VÀ cập nhật alertLevel (TÁCH RA RIÊNG)
// (Bạn có thể chuyển hàm này sang file utils nếu muốn dùng chung với cron)
const sendNotificationAndUpdateLevel = async (
  userId: string | Types.ObjectId,
  message: string,
  type: string, // 'budget_warning' hoặc 'budget_category_warning'
  budgetId: Types.ObjectId,
  newThreshold: number,
  isCategory: boolean,
  categoryName?: string
): Promise<boolean> => {
  try {
    // 1. Cập nhật mức cảnh báo vào DB để không báo lại mức này nữa
    if (isCategory && categoryName) {
      // Cập nhật cho danh mục con
      await Budget.updateOne(
        { _id: budgetId, "categories.category": categoryName },
        { $set: { "categories.$.alertLevel": newThreshold } }
      );
    } else {
      // Cập nhật cho ngân sách tổng
      await Budget.findByIdAndUpdate(budgetId, { alertLevel: newThreshold });
    }

    // 2. 🔥 GỌI SERVICE THÔNG BÁO (Lưu DB + Bắn Socket)
    await createAndSendNotification(
        userId, 
        type, 
        message, 
        "/budget" // Link để user bấm vào thông báo sẽ nhảy sang trang Budget
    );

    console.log(`📢 Đã gửi thông báo mức ${newThreshold}% cho user ${userId}`);
    return true;
  } catch (error) {
    console.error("❌ Lỗi khi cập nhật level/gửi thông báo:", error);
    return false;
  }
};

/**
 * [Refactored] Kiểm tra ngân sách cho MỘT user
 */
export const checkBudgetAlertForUser = async (userId: Types.ObjectId | string) => {
  console.log(`👉 Bắt đầu kiểm tra ngân sách tức thì cho user: ${userId}`);

  const now = dayjs();
  const month = now.month() + 1;
  const year = now.year();

  // 1. Tìm Budget
  const budget = await Budget.findOne({ user: userId, month, year });
  if (!budget) return; // Không có budget thì bỏ qua

  const { _id: budgetId, totalAmount: totalBudgetBase, alertLevel = 0, categories } = budget;
  const start = now.startOf('month').toDate();
  const end = now.endOf('month').toDate();

  // 2. Lấy giao dịch
  const transactions = await Transaction.find({
    user: userId,
    type: 'expense',
    date: { $gte: start, $lte: end },
  });

  // 3. Tính toán (Đa tiền tệ -> VND)
  const totalSpentBase = transactions.reduce((sum, tx) => sum + (tx.amount * (tx.exchangeRate || 1)), 0);

  const spentPerCategory: Record<string, number> = {};
  transactions.forEach(tx => {
    const categoryKey = tx.category || "uncategorized";
    const baseAmount = tx.amount * (tx.exchangeRate || 1);
    spentPerCategory[categoryKey] = (spentPerCategory[categoryKey] || 0) + baseAmount;
  });

  const thresholds = [100, 90, 80]; // Mốc cảnh báo
  let sentTotalAlert = false;

  // === A. Kiểm tra Ngân sách TỔNG ===
  const totalPercentUsed = totalBudgetBase > 0 ? Math.round((totalSpentBase / totalBudgetBase) * 100) : 0;
  
  for (const threshold of thresholds) {
    // Logic: Chỉ báo nếu % hiện tại vượt ngưỡng VÀ ngưỡng này chưa từng được báo (alertLevel < threshold)
    if (totalPercentUsed >= threshold && alertLevel < threshold && !sentTotalAlert) {
      const message = `⚠️ Cảnh báo: Bạn đã tiêu ${totalPercentUsed}% tổng ngân sách tháng ${month}/${year}.`;
      
      // Gọi hàm helper (đã tích hợp socket)
      const sent = await sendNotificationAndUpdateLevel(
        userId, message, 'budget_warning', budget._id as Types.ObjectId, threshold, false
      );
      
      if (sent) sentTotalAlert = true; // Chỉ gửi 1 thông báo cao nhất
      break; // Break để không gửi thêm thông báo cho các mốc thấp hơn (ví dụ vượt 100 thì ko cần báo 90 nữa)
    }
  }

  // === B. Kiểm tra Ngân sách DANH MỤC ===
  if (categories && categories.length > 0) {
    for (const catBudget of categories) {
      const { category, amount: categoryBudgetBase, alertLevel: oldCatAlertLevel = 0 } = catBudget;
      const spent = spentPerCategory[category] || 0;
      const percentUsed = categoryBudgetBase > 0 ? Math.round((spent / categoryBudgetBase) * 100) : 0;
      
      // Check ngưỡng
      for (const threshold of thresholds) {
        if (percentUsed >= threshold && oldCatAlertLevel < threshold) {
          const message = `⚠️ Danh mục "${category}" đã dùng hết ${percentUsed}% ngân sách.`;
          
          await sendNotificationAndUpdateLevel(
            userId, message, 'budget_category_warning', budget._id as Types.ObjectId, threshold, true, category
          );
          
          break; // Gửi mốc cao nhất rồi thì thôi
        }
      }
    }
  }
};