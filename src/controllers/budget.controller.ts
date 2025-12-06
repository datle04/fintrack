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
          _id: "$category", // Nhóm theo danh mục
          spentAmount: {
            $sum: {
              $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }],
            },
          },
        },
      },
    ]);

    // 4️⃣ Tính TỔNG CHI TIÊU THỰC TẾ (Của tất cả danh mục)
    // Thay vì cộng trong vòng lặp, ta cộng trực tiếp từ kết quả Aggregation
    const realTotalSpent = aggregationResult.reduce(
      (sum, item) => sum + item.spentAmount, 
      0
    );

    // 5️⃣ Map dữ liệu cho các danh mục ĐÃ ĐẶT NGÂN SÁCH
    const categoryStats = [];
    
    // Biến này chỉ để track xem trong ngân sách con đã tiêu bao nhiêu (nếu cần)
    // let totalBudgetedSpent = 0; 

    for (const budgetedCategory of budgetDoc.categories) {
      const resultItem = aggregationResult.find(
        (item) => item._id === budgetedCategory.category
      );

      const spent = resultItem?.spentAmount || 0;
      // totalBudgetedSpent += spent; // (Không dùng biến này để tính tổng nữa)

      const budgetedAmountVND = budgetedCategory.amount;
      const originalBudgetedAmount = budgetedCategory.originalAmount;

      const percentUsed =
        budgetedAmountVND > 0 ? (spent / budgetedAmountVND) * 100 : 0;

      categoryStats.push({
        category: budgetedCategory.category,
        originalBudgetedAmount: originalBudgetedAmount,
        budgetedAmount: budgetedAmountVND,
        spentAmount: spent,
        percentUsed: percentUsed > 100 ? 100 : Number(percentUsed.toFixed(1)),
      });
    }

    // 6️⃣ Tính toán tổng quan (Sử dụng realTotalSpent)
    const totalBudget = budgetDoc.totalAmount;
    const totalPercentUsed =
      totalBudget > 0 ? (realTotalSpent / totalBudget) * 100 : 0;

    // 7️⃣ Trả kết quả
    res.status(200).json({
      month: budgetDoc.month,
      year: budgetDoc.year,
      originalAmount: Number((budgetDoc.originalAmount ?? 0).toFixed(0)),
      originalCurrency: budgetDoc.originalCurrency ?? 'VND',
      totalBudget: Number(totalBudget.toFixed(0)),
      totalSpent: Number(realTotalSpent.toFixed(0)), // <-- ĐÃ SỬA: Hiển thị tổng chi thực tế
      totalPercentUsed: Number(totalPercentUsed.toFixed(1)), // <-- ĐÃ SỬA: % dựa trên tổng chi thực tế
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