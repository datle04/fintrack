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

    // 1. Lấy tiền tệ hiển thị (Target Currency)
    const user = await User.findById(userId).select("currency").lean();
    const targetCurrency = user?.currency || "VND";

    // 2. Gọi Service
    const [totals, topSpendingRes, budgetDoc] = await Promise.all([
      calculateTotalStats(userId, start, end, targetCurrency),
      calculateCategoryStats(userId, start, end, "expense", targetCurrency, 3), 
      Budget.findOne({ user: userId, month, year }).lean()
    ]);

    // 3. Xử lý Budget: Tính toán giá trị hiển thị (Quy đổi)
    let displayBudgetAmount = 0;
    
    if (budgetDoc) {
       // Lấy tỷ giá (VND -> Target)
       const rate = (topSpendingRes as any).conversionRate || 1;
       
       // Tính số tiền quy đổi để so sánh logic (VND -> Target)
       displayBudgetAmount = budgetDoc.totalAmount * rate;

       // Nếu trùng currency gốc thì lấy số gốc cho đẹp (tránh sai số)
       if (budgetDoc.originalCurrency === targetCurrency) {
           displayBudgetAmount = budgetDoc.originalAmount;
       }
    }

    // 4. Raw Data cho Top Spending
    const formattedTopSpending = topSpendingRes.stats.map((item: any) => ({
      key: item.category,
      amount: item.displayAmount
    }));

    // 5. Trả về kết quả
    res.status(200).json({
      success: true,
      data: {
        month,
        year,
        currency: targetCurrency, // Đơn vị tiền tệ hiển thị chung (Target)
        
        income: totals.income,
        expense: totals.expense,
        balance: totals.balance,
        
        // --- 🔥 THÔNG TIN NGÂN SÁCH CHI TIẾT ---
        budget: budgetDoc ? {
            amount: displayBudgetAmount,      // Số tiền đã quy đổi (để so sánh với income/expense)
            originalAmount: budgetDoc.originalAmount, // Số tiền gốc user nhập
            originalCurrency: budgetDoc.originalCurrency || "VND" // Đơn vị gốc user nhập
        } : null,
        
        topSpending: formattedTopSpending
      }
    });

  } catch (error) {
    console.error("❌ Financial Health Error:", error);
    res.status(500).json({ message: "Lỗi phân tích sức khỏe tài chính" });
  }
};