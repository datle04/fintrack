// src/controllers/admin/budget.controller.ts
import { Response } from "express";
import mongoose from "mongoose";
import Notification from "../../models/Notification";
import { logAction } from "../../utils/logAction";
import Budget from "../../models/Budget";
import { AuthRequest } from "../../middlewares/requireAuth";
import { processTransactionData } from "../transaction.controller";

// --- Helper Functions (Để format thông báo) ---
const formatVND = (num: number) =>
  (num || 0).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
// ---------------------------------------------

/**
 * [MỚI] Lấy tất cả ngân sách (có phân trang và bộ lọc)
 * GET /admin/budgets?page=1&limit=20&userId=...&month=...&year=...
 */
export const getAllBudgets = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const { userId, month, year } = req.query;
  const filter: any = {};

  if (userId && mongoose.Types.ObjectId.isValid(userId as string)) {
    filter.user = userId; //
  }
  if (month) {
    filter.month = parseInt(month as string); //
  }
  if (year) {
    filter.year = parseInt(year as string); //
  }

  try {
    const budgets = await Budget.find(filter)
      .populate("user", "name email") // Liên kết đến model User
      .sort({ year: -1, month: -1 }) // Sắp xếp mới nhất lên đầu
      .skip(skip)
      .limit(limit);

    const total = await Budget.countDocuments(filter);

    res.json({
      budgets,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy tất cả ngân sách (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [MỚI] Lấy ngân sách theo ID
 * GET /admin/budget/:budgetId
 */
export const getBudgetById = async (req: AuthRequest, res: Response) => {
  const { budgetId } = req.params;

  try {
    const budget = await Budget.findById(budgetId).populate("user", "name email currency");

    if (!budget) {
      res.status(404).json({ message: "Không tìm thấy ngân sách" });
      return;
    }

    res.json(budget);
  } catch (error) {
    console.error("❌ Lỗi khi lấy ngân sách theo ID (admin):", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * [CẬP NHẬT LẦN 3] Admin cập nhật ngân sách (Xử lý đa tiền tệ cho Tổng và Danh mục con)
 * PUT /admin/budgets/:budgetId
 */
export const adminUpdateBudget = async (req: AuthRequest, res: Response) => {
  const { budgetId } = req.params;
  
  // 1. Lấy dữ liệu thô từ admin
  const {
    reason,
    month,
    year,
    originalAmount, // Số tiền gốc (ví dụ: 100)
    originalCurrency, // Tiền tệ gốc (ví dụ: "USD")
    categories, // Mảng các danh mục con (chỉ chứa 'category' và 'originalAmount')
  } = req.body;

  try {
    // 2. Tìm ngân sách gốc để so sánh
    const originalBudget = await Budget.findById(budgetId);
    if (!originalBudget) {
      res.status(404).json({ message: "Không tìm thấy ngân sách" });
      return;
    }

    // 3. KIỂM TRA TRÙNG LẶP (Logic cũ, đã đúng)
    const isChangingMonthYear =
      (month && month !== originalBudget.month) ||
      (year && year !== originalBudget.year);

    if (isChangingMonthYear) {
      const newMonth = month || originalBudget.month;
      const newYear = year || originalBudget.year;
      const existingBudget = await Budget.findOne({
        user: originalBudget.user,
        month: newMonth,
        year: newYear,
        _id: { $ne: budgetId },
      });
      if (existingBudget) {
        res.status(409).json({
          message: `Cập nhật thất bại: Người dùng này đã có ngân sách cho tháng ${newMonth}/${newYear}.`,
        });
        return;
      }
    }
    
    // --- 4. XỬ LÝ QUY ĐỔI TIỀN TỆ (LOGIC MỚI QUAN TRỌNG) ---
    // (Giống hệt logic trong 'createBudget' của bạn)

    // 4a. Xác định tiền tệ và tỷ giá
    // Nếu admin không cung cấp tiền tệ mới, dùng tiền tệ cũ của budget
    const currencyToUse = originalCurrency || originalBudget.originalCurrency;
    
    // Gọi service để lấy tỷ giá (cho cả tổng và danh mục con)
    // Dùng originalAmount (mới hoặc cũ) để tính
    const { 
        exchangeRate: newExchangeRate, 
        currency: finalCurrency // Luôn là 'VND' theo model của bạn
    } = await processTransactionData({ 
        currency: currencyToUse, 
        amount: originalAmount || originalBudget.originalAmount 
    });

    // 4b. Tính toán 'totalAmount' (VND)
    const newTotalAmount_Base = (originalAmount || originalBudget.originalAmount) * newExchangeRate;

    // 4c. Tính toán 'amount' (VND) cho TỪNG danh mục con
    const processedCategories = (categories || originalBudget.categories).map((cat: any) => ({
        category: cat.category,
        originalAmount: cat.originalAmount, // Giữ lại số tiền gốc của danh mục con
        // Quy đổi 'amount' của danh mục con về VND
        amount: cat.originalAmount * newExchangeRate, 
        alertLevel: cat.alertLevel || 0
    }));
    // ---------------------------------------------

    // 5. So sánh thay đổi (dùng giá trị GỐC và VND)
    const changes: string[] = [];
    if (originalBudget.totalAmount !== newTotalAmount_Base) {
      changes.push(
        `Tổng ngân sách từ ${formatVND(
          originalBudget.totalAmount
        )} (${originalBudget.originalAmount} ${originalBudget.originalCurrency}) 
         thành ${formatVND(
          newTotalAmount_Base
        )} (${originalAmount || originalBudget.originalAmount} ${currencyToUse})`
      );
    }
    if (JSON.stringify(originalBudget.categories) !== JSON.stringify(processedCategories)) {
      changes.push(`Ngân sách cho các danh mục con đã bị thay đổi (đã quy đổi lại tỷ giá)`);
    }
    // ... (so sánh tháng, năm nếu cần)

    // 6. Cập nhật và Lưu
    // Gán các giá trị mới đã qua xử lý
    originalBudget.originalAmount = originalAmount || originalBudget.originalAmount;
    originalBudget.originalCurrency = currencyToUse;
    originalBudget.exchangeRate = newExchangeRate;
    originalBudget.totalAmount = newTotalAmount_Base; // <-- Cập nhật base amount
    originalBudget.currency = finalCurrency; // Luôn là VND
    originalBudget.categories = processedCategories; // <-- Cập nhật mảng categories đã xử lý

    if (month) originalBudget.month = month;
    if (year) originalBudget.year = year;

    const updatedBudget = await originalBudget.save();

    // 7. Gửi thông báo (nếu có thay đổi)
    if (changes.length > 0) {
      const message = `Một quản trị viên đã cập nhật ngân sách tháng ${originalBudget.month}/${originalBudget.year} của bạn.
                       Các thay đổi: ${changes.join(", ")}.
                       ${reason ? `Lý do: ${reason}` : ""}`;
                       
      await Notification.create({
        user: updatedBudget.user,
        type: "info",
        message: message,
      });
    }

    // 8. Ghi Log
    await logAction(req, {
      action: "Admin Update Budget",
      statusCode: 200,
      description: `Admin đã cập nhật ngân sách ID: ${budgetId}. Lý do: ${
        reason || "Không có"
      }. Thay đổi: ${changes.join(", ") || "Không có"}`,
    });

    // --- 9. POPULATE THÔNG TIN USER (BƯỚC MỚI) ---
    // Populate trường 'user' 
    // với các trường 'name', 'email', 'currency' từ model 'User'
    await updatedBudget.populate({
        path: 'user',
        select: 'name email currency'
    });

    // 10. Trả về dữ liệu đã populate
    res.json(updatedBudget);

  } catch (error: any) {
    // ... (xử lý lỗi 409 và 500 như cũ)
    console.error("❌ Lỗi khi admin cập nhật ngân sách:", error);
    if (error.code === 11000) {
      res.status(409).json({ message: "Cập nhật thất bại: Ngân sách cho tháng/năm này đã tồn tại." });
      return;
    }
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * [MỚI] Admin xóa ngân sách
 * DELETE /admin/budgets/:budgetId
 */
export const adminDeleteBudget = async (req: AuthRequest, res: Response) => {
  const { budgetId } = req.params;
  const { reason } = req.body; // Lấy lý do

  try {
    // 1. Tìm và xóa
    const deletedBudget = await Budget.findByIdAndDelete(budgetId);

    if (!deletedBudget) {
      res.status(404).json({ message: "Không tìm thấy ngân sách" });
      return;
    }

    // 2. Gửi thông báo
    const message = `Một quản trị viên đã xóa ngân sách tháng ${deletedBudget.month}/${deletedBudget.year} của bạn.
                     ${reason ? `Lý do: ${reason}` : ""}`;

    await Notification.create({
      user: deletedBudget.user,
      type: "info",
      message: message,
    });

    // 3. Ghi Log
    await logAction(req, {
      action: "Admin Delete Budget",
      statusCode: 200,
      description: `Admin đã xóa ngân sách ID: ${budgetId} (Tháng ${deletedBudget.month}/${deletedBudget.year}) của user ${deletedBudget.user}. Lý do: ${reason || "Không có"}`,
    });

    res.json({ message: "Đã xóa ngân sách thành công" });
  } catch (error) {
    console.error("❌ Lỗi khi admin xóa ngân sách:", error);
    await logAction(req, {
      action: "Admin Delete Budget",
      statusCode: 500,
      description: `Lỗi khi xóa ngân sách ID: ${budgetId}. Lý do: ${
        reason || "Không có"
      }`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};