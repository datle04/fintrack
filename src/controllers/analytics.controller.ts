import { Response } from "express";
import { AuthRequest } from "../middlewares/requireAuth";
import User from "../models/User";
import Budget from "../models/Budget";
import { getStartOfMonth, getEndOfMonth } from "../utils/dateHelper";
import { calculateTotalStats, calculateCategoryStats } from "../services/statistics.service";

export const getFinancialHealth = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const start = getStartOfMonth(year, month);
    const end = getEndOfMonth(year, month);

    const user = await User.findById(userId).select("currency").lean();
    const targetCurrency = user?.currency || "VND";

    const [totals, topSpendingRes, budgetDoc] = await Promise.all([
      calculateTotalStats(userId, start, end, targetCurrency),
      calculateCategoryStats(userId, start, end, "expense", targetCurrency, 3), 
      Budget.findOne({ user: userId, month, year }).lean()
    ]);

    let displayBudgetAmount = 0;
    
    if (budgetDoc) {

       const rate = (topSpendingRes as any).conversionRate || 1;
       
       displayBudgetAmount = budgetDoc.totalAmount * rate;

       if (budgetDoc.originalCurrency === targetCurrency) {
           displayBudgetAmount = budgetDoc.originalAmount;
       }
    }

    const formattedTopSpending = topSpendingRes.stats.map((item: any) => ({
      key: item.category,
      amount: item.displayAmount
    }));

    res.status(200).json({
      success: true,
      data: {
        month,
        year,
        currency: targetCurrency, 
        
        income: totals.income,
        expense: totals.expense,
        balance: totals.balance,
        
        budget: budgetDoc ? {
            amount: displayBudgetAmount,     
            originalAmount: budgetDoc.originalAmount,
            originalCurrency: budgetDoc.originalCurrency || "VND" 
        } : null,
        
        topSpending: formattedTopSpending
      }
    });

  } catch (error) {
    console.error("❌ Financial Health Error:", error);
    res.status(500).json({ message: "Lỗi phân tích sức khỏe tài chính" });
  }
};