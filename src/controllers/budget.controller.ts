// src/controllers/budget.controller.ts
import { Request, Response } from "express";
import Transaction from "../models/Transaction";
import { AuthRequest } from "../middlewares/requireAuth";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import mongoose from "mongoose";
import { logAction } from "../utils/logAction";
import { getEndOfMonth, getStartOfMonth } from "../utils/dateHelper";
import { getExchangeRate } from "../services/exchangeRate";
import { checkBudgetAlertForUser } from "../services/budget.service";
import Budget from "../models/Budget";
import { getRawSpendingByCategory } from "../services/statistics.service";

dayjs.extend(utc);

// --- HELPER FUNCTIONS ---
// Hàm xử lý logic quy đổi Ngân sách (Cần gọi getExchangeRate)
export const processBudgetData = async (data: any) => {
  const originalCurrency = (data.currency || 'VND').toUpperCase();
  const originalTotalAmount = Number(data.totalAmount);
  const originalCategories = data.categories || [];
  const rate = await getExchangeRate(data.currency);
  
  let exchangeRate = 1;
  let convertedTotalAmount = originalTotalAmount;

  // 1. LẤY TỶ GIÁ (Nếu cần)
  if (originalCurrency !== 'VND') {
    // Assume getExchangeRate is defined and available
    exchangeRate = await getExchangeRate(originalCurrency); 
    convertedTotalAmount = originalTotalAmount * exchangeRate;
  }

  // 2. CHUYỂN ĐỔI CATEGORY AMOUNTS
  const convertedCategories = originalCategories.map((cat: any) => {
    return {
        category: cat.category,
        // Quy đổi số tiền con về VND (Base Currency)
        // LƯU Ý: Nếu categories[].amount là USD, nó sẽ được nhân với exchangeRate (USD->VND)
        amount: Number(cat.amount) * exchangeRate, 
        alertLevel: cat.alertLevel || 0,
    };
  });

  return {
      // Gốc (cho hiển thị)
      originalAmount: originalTotalAmount,
      originalCurrency,
      exchangeRate: rate,
      convertedTotalAmount,
      convertedCategories,
      finalExchangeRate: exchangeRate,
  };
}

export const setOrUpdateBudget = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // 💡 ĐỔI TÊN: Dùng 'originalAmount' để khớp với Schema và tư duy "Tiền gốc"
    const { month, year, originalAmount, currency, categories } = req.body; 

    // 1. Xử lý đa tiền tệ (Helper của bạn)
    // Helper nên trả về cả exchangeRate đã dùng để quy đổi
    const processed = await processBudgetData({ 
        currency, 
        totalAmount: originalAmount, // Truyền vào helper số tiền gốc
        categories 
    });

    // 2. Map dữ liệu Categories (Logic của bạn giữ nguyên, chỉ làm gọn lại)
    const convertedCategoriesMap = new Map(
      (processed.convertedCategories || []).map((cat: any) => [cat.category, cat.amount])
    );

    const finalCategories = categories?.map((originalCategory: any) => ({
      category: originalCategory.category,
      originalAmount: originalCategory.amount, // Số user nhập
      amount: convertedCategoriesMap.get(originalCategory.category) || 0, // Số quy đổi
      alertLevel: 0 // Reset alert level cho category
    }));

    // 3. CHỨC NĂNG UPSERT (Update hoặc Insert) - "Trái tim" của hàm này
    const budget = await Budget.findOneAndUpdate(
      // A. Điều kiện tìm kiếm
      { user: userId, month, year },

      // B. Dữ liệu để lưu (Ghi đè hoặc Tạo mới)
      {
        $set: {
          originalAmount: processed.originalAmount,   // VD: 100
          originalCurrency: processed.originalCurrency, // VD: USD
          
          totalAmount: processed.convertedTotalAmount, // VD: 2,500,000
          currency: 'VND', // Base Currency cố định
          
          // Lưu tỷ giá thực tế thay vì hardcode số 1
          exchangeRate: processed.exchangeRate || 1, 

          categories: finalCategories,
          alertLevel: 0 // Reset cảnh báo mỗi khi sửa ngân sách
        }
      },

      // C. Options thần thánh
      { 
        new: true,   // Trả về document mới nhất
        upsert: true, // Chưa có thì tạo, có rồi thì sửa
        setDefaultsOnInsert: true // Áp dụng default value của Schema
      }
    );

    // 4. Kiểm tra cảnh báo ngay lập tức (Hồi tố hoặc check lại)
    await checkBudgetAlertForUser(userId);

    // 5. Log hành động
    await logAction(req, {
      action: "setOrUpdateBudget",
      statusCode: 200,
      description: `Đã thiết lập ngân sách tháng ${month}/${year}`,
    });

    // Trả về kết quả (Budget lúc này đã được cập nhật alertLevel từ hàm check ở trên nếu có)
    // Tuy nhiên hàm checkBudgetAlert thường update ngầm, nên nếu muốn hiển thị alertLevel mới nhất
    // bạn có thể reload lại biến budget hoặc tin tưởng rằng client sẽ tự fetch lại status.
    const finalBudget = await Budget.findById(budget._id);

    res.status(200).json({ 
        message: 'Thiết lập ngân sách thành công.', 
        budget: finalBudget 
    });

  } catch (err) {
    console.error("❌ Lỗi setOrUpdateBudget:", err);
    await logAction(req, {
      action: "setOrUpdateBudget",
      statusCode: 500,
      description: 'Lỗi server khi xử lý ngân sách.',
      level: "error"
    });
    res.status(500).json({ message: 'Lỗi khi xử lý ngân sách.', error: err });
  }
};


// [GET] /api/budget
export const getMonthlyBudget = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { month, year } = req.query;

    // 1. Xác định thời gian
    const m = Number(month);
    const y = Number(year);
    const start = getStartOfMonth(y, m);
    const end = getEndOfMonth(y, m);

    // 2. Lấy Budget đã cài đặt
    const budgetDoc = await Budget.findOne({ user: userId, month, year });

    // Nếu chưa có ngân sách → trả về mặc định
    if (!budgetDoc) {
      res.status(200).json({
        message: "Không tìm thấy ngân sách cho tháng này",
        month,
        year,
        originalAmount: 0,
        originalCurrency: "VND",
        totalBudget: 0,
        totalSpent: 0,
        totalPercentUsed: 0,
        categoryStats: [],
      });
      return;
    }

    // 3. 🔥 GỌI SERVICE: Lấy chi tiêu thực tế (Chỉ lấy raw VND để so sánh)
    // Không cần logic aggregate phức tạp trong controller nữa
    const actualSpending = await getRawSpendingByCategory(userId, start, end);

    // 4. Tính toán Logic Business (Ghép Budget vs Actual)
    // Tính tổng chi thực tế
    const realTotalSpent = actualSpending.reduce((sum, item) => sum + item.spentAmount, 0);

    const categoryStats = budgetDoc.categories.map((budgetCat) => {
      // Tìm số tiền đã chi cho category này trong mảng actualSpending
      const found = actualSpending.find((s) => s._id === budgetCat.category);
      const spent = found?.spentAmount || 0;
      
      const percent = budgetCat.amount > 0 ? (spent / budgetCat.amount) * 100 : 0;

      return {
        category: budgetCat.category,
        originalBudgetedAmount: budgetCat.originalAmount,
        budgetedAmount: budgetCat.amount, // VND
        spentAmount: spent, // VND
        percentUsed: percent > 100 ? 100 : Number(percent.toFixed(1)),
      };
    });

    const totalBudget = budgetDoc.totalAmount;
    const totalPercent = totalBudget > 0 ? (realTotalSpent / totalBudget) * 100 : 0;

    // 5. Trả về kết quả
    res.status(200).json({
      month: budgetDoc.month,
      year: budgetDoc.year,
      originalAmount: Number((budgetDoc.originalAmount || 0).toFixed(0)),
      originalCurrency: budgetDoc.originalCurrency || "VND",
      totalBudget: Number(totalBudget.toFixed(0)),
      totalSpent: Number(realTotalSpent.toFixed(0)),
      totalPercentUsed: Number(totalPercent.toFixed(1)),
      categoryStats,
    });
  } catch (error) {
    console.error("❌ Lỗi khi lấy Budget Data:", error);
    res
      .status(500)
      .json({ message: "Không thể lấy dữ liệu Ngân sách", error });
  }
};

// [DELETE] /api/budget
export const deleteBudget = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Dùng ! để khẳng định tồn tại (do middleware Auth)
    const { month, year } = req.query;

    // 1. Validate Input
    if (!month || !year) {
      res.status(400).json({ message: 'Vui lòng cung cấp tháng và năm để xóa.' });
      return;
    }

    // 2. Xóa Ngân sách
    const deletedBudget = await Budget.findOneAndDelete({
      user: userId,
      month: Number(month),
      year: Number(year),
    });

    if (!deletedBudget) {
      res.status(404).json({ message: `Không tìm thấy ngân sách tháng ${month}/${year} để xóa.` });
      return;
    }

    // 3. Ghi Log (Nhất quán với các hàm khác)
    await logAction(req, {
      action: "deleteBudget",
      statusCode: 200,
      description: `User xóa ngân sách tháng ${month}/${year} (Tổng: ${deletedBudget.totalAmount} VND)`,
    });

    // 4. Phản hồi
    res.status(200).json({
      message: `Đã xóa ngân sách tháng ${month}/${year} thành công.`,
      deletedBudget, // Trả về để Frontend cập nhật UI nếu cần
    });

  } catch (err) {
    console.error("❌ Lỗi khi xóa Budget:", err);
    await logAction(req, {
      action: "deleteBudget",
      statusCode: 500,
      description: 'Lỗi server khi xóa ngân sách.',
      level: "error"
    });
    res.status(500).json({ message: 'Lỗi khi xóa ngân sách.', error: err });
  }
};