// src/controllers/budget.controller.ts
import { Request, Response } from "express";
import Budget from "../models/Budget";
import Transaction from "../models/Transaction";
import { AuthRequest } from "../middlewares/requireAuth";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import mongoose from "mongoose";
import { logAction } from "../utils/logAction";
import { getEndOfMonth, getStartOfMonth } from "../utils/dateHelper";
import { getExchangeRate } from "../services/exchangeRate";

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
  
  try {
    const { month, year, totalAmount, categories, currency } = req.body; 
    const BASE_CURRENCY = 'VND';

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
      existing.originalAmount = processed.originalAmount; // Gốc (Ví dụ: 100)
      existing.originalCurrency = processed.originalCurrency; // Gốc (Ví dụ: USD)
      existing.totalAmount = processed.convertedTotalAmount; // Quy đổi (Ví dụ: 2,500,000 VND)
      
      existing.categories = finalCategories; // Category amounts đã quy đổi
      
      existing.currency = BASE_CURRENCY; // Base Currency (VND)
      existing.exchangeRate = 1; // Base Exchange Rate (1)
      
      await existing.save();

      await logAction(req, {
        action: "updateBudget",
        statusCode: 200,
        description: `Cập nhật ngân sách ${month}/${year}`,
      });

      res.json({ message: 'Cập nhật ngân sách thành công.', budget: existing });
      return;
    }

    // 3. TẠO MỚI: Lưu trữ KÉP (Dual Storage)
    const newBudget = await Budget.create({
        user: req.userId,
        month,
        year,
        originalAmount: processed.originalAmount,
        originalCurrency: processed.originalCurrency,
        totalAmount: processed.convertedTotalAmount, // VND
        categories: finalCategories, // Category amounts đã quy đổi
        currency: BASE_CURRENCY, 
        exchangeRate: 1, 
    });

    await logAction(req, {
      action: "createBudget",
      statusCode: 201,
      description: `Tạo ngân sách ${month}/${year}`,
    });

    res.status(201).json({ message: 'Tạo ngân sách thành công.', budget: newBudget });
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
    const userId = req.userId;
    const { month, year } = req.query;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // 1️⃣ Xác định phạm vi ngày của tháng theo UTC
    const startOfMonth = getStartOfMonth(Number(year), Number(month));
    const endOfMonth = getEndOfMonth(Number(year), Number(month));

    // 2️⃣ Tìm ngân sách đã thiết lập
    const budgetDoc = await Budget.findOne({
      user: userId,
      month,
      year,
    });

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

    // 3️⃣ Tính chi tiêu thực tế trong tháng (quy đổi theo tỷ giá nếu có)
    const aggregationResult = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          type: "expense",
          date: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: "$category",
          spentAmount: {
            $sum: {
              $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }],
            },
          },
        },
      },
    ]);

    // 4️⃣ Kết hợp chi tiêu thực tế với dữ liệu ngân sách
    let totalSpent = 0;
    const categoryStats = [];

    // --- BẮT ĐẦU THAY ĐỔI ---
    for (const budgetedCategory of budgetDoc.categories) {
      // budgetedCategory BÂY GIỜ LÀ:
      // { category: 'food', originalAmount: 100, amount: 2500000 }

      const resultItem = aggregationResult.find(
        (item) => item._id === budgetedCategory.category
      );

      const spent = resultItem?.spentAmount || 0; // Đây là chi tiêu (VND)
      totalSpent += spent;

      // Lấy cả 2 giá trị từ ngân sách
      const budgetedAmountVND = budgetedCategory.amount; // Tiền ngân sách (VND)
      const originalBudgetedAmount = budgetedCategory.originalAmount; // Tiền ngân sách (Gốc)

      // Tính % sử dụng DỰA TRÊN GIÁ TRỊ VND (VND / VND)
      const percentUsed =
        budgetedAmountVND > 0 ? (spent / budgetedAmountVND) * 100 : 0;

      categoryStats.push({
        category: budgetedCategory.category,
        originalBudgetedAmount: originalBudgetedAmount, // Gốc (ví dụ: 100)
        budgetedAmount: budgetedAmountVND, // Quy đổi (ví dụ: 2,500,000)
        spentAmount: spent, // Chi tiêu (VND)
        percentUsed: percentUsed > 100 ? 100 : Number(percentUsed.toFixed(1)),
      });
    }
    // --- KẾT THÚC THAY ĐỔI ---

    // 5️⃣ Tính tổng chi tiêu, phần trăm đã sử dụng
    const totalBudget = budgetDoc.totalAmount;
    const totalPercentUsed =
      totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

    // 6️⃣ Trả kết quả về client
    res.status(200).json({
      month: budgetDoc.month,
      year: budgetDoc.year,
      originalAmount: Number((budgetDoc.originalAmount ?? 0).toFixed(0)),
      originalCurrency: budgetDoc.originalCurrency ?? 'VND',
      totalBudget: Number(totalBudget.toFixed(0)),
      totalSpent: Number(totalSpent.toFixed(0)),
      totalPercentUsed: Number(totalPercentUsed.toFixed(1)),
      categoryStats,
    });
  } catch (error) {
    console.error("❌ Lỗi khi lấy Budget Data:", error);
    res
      .status(500)
      .json({ message: "Không thể lấy dữ liệu Ngân sách", error });
  }
};

// [DELETE] /api/budget?month=...&year=...
export const deleteBudget = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    // Lấy month và year từ query parameters
    const { month, year } = req.query;

    // 1. Kiểm tra thông tin đầu vào
    if (!month || !year) {
      const msg = 'Vui lòng cung cấp tháng và năm để xóa ngân sách.';
      await logAction(req, {
        action: "deleteBudget",
        statusCode: 400,
        description: msg,
      });
      res.status(400).json({ message: msg });
      return;
    }

    // 2. Tìm và xóa ngân sách
    // findOneAndDelete sẽ tìm, xóa, và trả về tài liệu đã bị xóa (nếu tìm thấy)
    const deletedBudget = await Budget.findOneAndDelete({
      user: userId,
      month: Number(month),
      year: Number(year),
    });

    // 3. Kiểm tra xem có tìm thấy và xóa được không
    if (!deletedBudget) {
      const msg = `Không tìm thấy ngân sách nào cho tháng ${month}/${year} để xóa.`;
      await logAction(req, {
        action: "deleteBudget",
        statusCode: 404,
        description: msg,
      });
      res.status(404).json({ message: msg });
      return;
    }

    // 4. Ghi log và trả về thành công
    await logAction(req, {
      action: "deleteBudget",
      statusCode: 200,
      description: `Đã xóa ngân sách tháng ${month}/${year}.`,
    });

    res.status(200).json({
      message: `Xóa ngân sách tháng ${month}/${year} thành công.`,
      deletedBudget: deletedBudget, // Trả lại tài liệu vừa xóa (tùy chọn)
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