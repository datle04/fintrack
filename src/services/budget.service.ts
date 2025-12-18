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

    const budget = await Budget.findOne({ user: userId, month, year });
    if (!budget) return; 

    const { 
      _id: budgetId, 
      totalAmount: totalBudgetBase, 
      alertLevel: dbTotalLevel = 0, 
      categories 
    } = budget;

    const start = now.startOf("month").toDate();
    const end = now.endOf("month").toDate();

    const transactions = await Transaction.find({
      user: userId,
      type: "expense",
      date: { $gte: start, $lte: end },
    });

    let totalSpentBase = 0;
    const spentPerCategory: Record<string, number> = {};

    transactions.forEach((tx) => {
      const baseAmount = tx.amount * (tx.exchangeRate || 1);

      totalSpentBase += baseAmount;

      const catKey = tx.category || "uncategorized";
      spentPerCategory[catKey] = (spentPerCategory[catKey] || 0) + baseAmount;
    });

    const totalPercent = totalBudgetBase > 0 
      ? Math.round((totalSpentBase / totalBudgetBase) * 100) 
      : 0;
    
    const currentTotalLevel = getThresholdLevel(totalPercent);

    if (currentTotalLevel !== dbTotalLevel) {
      const message = `⚠️ Cảnh báo: Bạn đã tiêu ${totalPercent}% tổng ngân sách tháng ${month}/${year}.`;
      await updateAlertLevelAndNotify(
        userId,
        budgetId as Types.ObjectId,
        currentTotalLevel,
        dbTotalLevel,      
        false,             
        "",                
        message
      );
    }

    if (categories && categories.length > 0) {
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
            true,      
            category,   
            message
          );
        }
      }));
    }

  } catch (error) {
    console.error(`❌ Lỗi checkBudgetAlertForUser (${userId}):`, error);
  }
};