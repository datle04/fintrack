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
      
      // Đã quy đổi (cho tính toán)
      convertedTotalAmount,
      convertedCategories,
      finalExchangeRate: exchangeRate,
  };
}

// POST /api/budget
export const setOrUpdateBudget = async (req: AuthRequest, res: Response) => {
  console.log(req.body);
  console.log("[USER ID]: "+ req.userId);
  
  try {
    const { month, year, totalAmount, categories, currency } = req.body; 
    const BASE_CURRENCY = 'VND';
    const userId = req.userId!;

    if (!month || !year || !totalAmount) {
      const msg = 'Vui lòng nhập tháng, năm và ngân sách tổng.';
      await logAction(req, {
        action: "setOrUpdateBudget",
        statusCode: 400,
        description: msg,
      });
      res.status(400).json({ message: msg });
      return;
    }

    // 1. 💡 XỬ LÝ ĐA TIỀN TỆ & QUY ĐỔI TẤT CẢ GIÁ TRỊ VỀ VND
    // totalAmount ở đây là giá trị gốc (USD) nếu currency là USD
    const processed = await processBudgetData({ 
        currency, 
        totalAmount,
        categories 
    });

    // --- BẮT ĐẦU THAY ĐỔI ---
    // Yêu cầu: Kết hợp `categories` (gốc) và `processed.convertedCategories` (đã quy đổi)
    // để mỗi category item đều có originalAmount và amount (VND)

    // 1. Tạo một Map để tra cứu nhanh các giá trị đã quy đổi
    const convertedCategoriesMap = new Map(
      (processed.convertedCategories || []).map((cat:any) => [cat.category, cat.amount])
    );

    // 2. Tạo mảng categories mới với đầy đủ thông tin
    // `categories` ở đây là lấy từ `req.body` (chứa giá trị gốc)
    const finalCategories = categories?.map((originalCategory: any) => {
      // Lấy số tiền đã quy đổi từ Map, nếu không có thì mặc định là 0
      const convertedAmount =
        convertedCategoriesMap.get(originalCategory.category) || 0;

      return {
        category: originalCategory.category,
        originalAmount: originalCategory.amount, // Gốc (ví dụ: 100 USD)
        amount: convertedAmount, // Đã quy đổi (ví dụ: 2,500,000 VND)
      };
    });
    // --- KẾT THÚC THAY ĐỔI ---

    const existing = await Budget.findOne({ user: req.userId, month, year });

    if (existing) {
      // 2. CẬP NHẬT: Lưu trữ KÉP (Dual Storage)
      existing.originalAmount = processed.originalAmount;
      existing.originalCurrency = processed.originalCurrency;
      existing.totalAmount = processed.convertedTotalAmount; 
      
      existing.categories = finalCategories; 
      existing.currency = BASE_CURRENCY;
      existing.exchangeRate = 1; 

      // Reset alert level tổng (để check lại với mức ngân sách mới)
      existing.alertLevel = 0;
      
      await existing.save();

      // 🔥 FIX LOGIC: Gọi hàm check ngay lập tức sau khi update
      // Để nếu ngân sách mới thấp hơn số đã chi -> Báo động ngay
      await checkBudgetAlertForUser(userId);

      await logAction(req, {
        action: "updateBudget",
        statusCode: 200,
        description: `Cập nhật ngân sách ${month}/${year}`,
      });

      // Lấy lại data mới nhất (bao gồm cả alertLevel vừa được check)
      const updatedBudget = await Budget.findById(existing._id);

      res.json({ message: 'Cập nhật ngân sách thành công.', updatedBudget });
      return;
    }

    // 3. TẠO MỚI: Lưu trữ KÉP (Dual Storage)
    const newBudget = await Budget.create({
        user: userId,
        month,
        year,
        originalAmount: processed.originalAmount,
        originalCurrency: processed.originalCurrency,
        totalAmount: processed.convertedTotalAmount,
        categories: finalCategories,
        currency: BASE_CURRENCY, 
        exchangeRate: 1, 
        alertLevel: 0
    });

    // 🔥 FIX LOGIC: Gọi hàm check ngay lập tức sau khi tạo
    // Để xử lý trường hợp "Hồi tố" (đã có giao dịch trước khi tạo budget)
    await checkBudgetAlertForUser(userId);

    await logAction(req, {
      action: "createBudget",
      statusCode: 201,
      description: `Tạo ngân sách ${month}/${year}`,
    });

    // Lấy lại data mới nhất
    const finalBudget = await Budget.findById(newBudget._id);

    res.status(201).json({ message: 'Tạo ngân sách thành công.', budget: finalBudget });
    return;

  } catch (err) {
    console.error(err);
    await logAction(req, {
      action: "setOrUpdateBudget",
      statusCode: 500,
      description: 'Lỗi server khi tạo/cập nhật ngân sách.',
      level: "error"
    });
    res.status(500).json({ message: 'Lỗi khi tạo/cập nhật ngân sách.', error: err });
    return;
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