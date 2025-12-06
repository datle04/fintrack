import { Types } from "mongoose";
import dayjs from "dayjs";
import Budget from "../models/Budget";
import Transaction from "../models/Transaction";
import { getThresholdLevel, updateAlertLevelAndNotify } from "./budget.alert.service";

/**
 * Kiểm tra ngân sách Real-time cho một User.
 * Logic: Tính tổng chi tiêu hiện tại -> So sánh với Budget -> Gọi Helper xử lý.
 */
export const checkBudgetAlertForUser = async (userId: Types.ObjectId | string) => {
  try {
    const now = dayjs();
    const month = now.month() + 1;
    const year = now.year();

    // 1. Tìm Budget tháng hiện tại
    const budget = await Budget.findOne({ user: userId, month, year });
    if (!budget) return; // Không có ngân sách thì bỏ qua

    const { 
      _id: budgetId, 
      totalAmount: totalBudgetBase, 
      alertLevel: dbTotalLevel = 0, 
      categories 
    } = budget;

    // 2. Lấy tất cả giao dịch chi tiêu trong tháng này
    // (Phải tính lại từ đầu để đảm bảo chính xác khi user sửa/xóa giao dịch cũ)
    const start = now.startOf("month").toDate();
    const end = now.endOf("month").toDate();

    const transactions = await Transaction.find({
      user: userId,
      type: "expense",
      date: { $gte: start, $lte: end },
    });

    // 3. Tính tổng chi tiêu (Quy đổi về VND)
    let totalSpentBase = 0;
    const spentPerCategory: Record<string, number> = {};

    transactions.forEach((tx) => {
      const baseAmount = tx.amount * (tx.exchangeRate || 1);
      
      // Cộng tổng
      totalSpentBase += baseAmount;

      // Cộng theo danh mục
      const catKey = tx.category || "uncategorized";
      spentPerCategory[catKey] = (spentPerCategory[catKey] || 0) + baseAmount;
    });

    // === A. XỬ LÝ NGÂN SÁCH TỔNG ===
    const totalPercent = totalBudgetBase > 0 
      ? Math.round((totalSpentBase / totalBudgetBase) * 100) 
      : 0;
    
    const currentTotalLevel = getThresholdLevel(totalPercent);

    // Gọi helper để quyết định (Báo, Reset hay Bỏ qua)
    if (currentTotalLevel !== dbTotalLevel) {
      const message = `⚠️ Cảnh báo: Bạn đã tiêu ${totalPercent}% tổng ngân sách tháng ${month}/${year}.`;
      await updateAlertLevelAndNotify(
        userId,
        budgetId as Types.ObjectId,
        currentTotalLevel, // Mức thực tế hiện tại
        dbTotalLevel,      // Mức đang lưu trong DB
        false,             // isCategory
        "",                // Category Name
        message
      );
    }

    // === B. XỬ LÝ NGÂN SÁCH DANH MỤC ===
    if (categories && categories.length > 0) {
      // Dùng Promise.all để chạy song song các category cho nhanh
      await Promise.all(categories.map(async (cat) => {
        const { category, amount: catBudget, alertLevel: dbCatLevel = 0 } = cat;
        
        const spent = spentPerCategory[category] || 0;
        const catPercent = catBudget > 0 
          ? Math.round((spent / catBudget) * 100) 
          : 0;
        
        const currentCatLevel = getThresholdLevel(catPercent);

        if (currentCatLevel !== dbCatLevel) {
          const message = `⚠️ Danh mục "${category}" đã dùng hết ${catPercent}% ngân sách.`;
          await updateAlertLevelAndNotify(
            userId,
            budgetId as Types.ObjectId,
            currentCatLevel,
            dbCatLevel,
            true,       // isCategory
            category,   // Category Name
            message
          );
        }
      }));
    }

  } catch (error) {
    console.error(`❌ Lỗi checkBudgetAlertForUser (${userId}):`, error);
  }
};