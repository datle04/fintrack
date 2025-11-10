import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';     // <-- Cập nhật đường dẫn
import Transaction from '../models/Transaction';      // <-- Cập nhật đường dẫn
import User from '../models/User';                  // <-- THÊM DÒNG NÀY
import { getStartOfDay, getEndOfDay } from '../utils/dateHelper'; // <-- Cập nhật đường dẫn
import { getConversionRate } from '../services/exchangeRate';
import Budget from '../models/Budget';

// [GET] /api/stats/category-stats (Assuming this is the endpoint)
export const getCategoryStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        
        // 1. Lấy params từ query
        const { type = "", startDate, endDate, currency: targetCurrencyQuery } = req.query; 

        if (!userId) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        
        if (!startDate || !endDate) {
            res.status(400).json({ message: "Thiếu startDate, endDate." });
            return;
        }

        // 2. Tiền tệ cơ sở của CSDL (Database) LUÔN là VND
        const APP_BASE_CURRENCY = 'VND'; 

        // 3. Lấy tiền tệ mặc định MÀ USER MUỐN XEM
        const user = await User.findById(userId).select('currency').lean();
        const userPreferredCurrency = user?.currency || APP_BASE_CURRENCY;

        // 4. Xác định tiền tệ mục tiêu (target currency)
        const targetCurrency = 
            (targetCurrencyQuery as string) || 
            userPreferredCurrency;

        // 5. Lấy tỷ giá quy đổi
        let conversionRate = 1.0;
        try {
            // Luôn quy đổi từ VND (Base) sang Target (Display)
            conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);
        } catch (rateError) {
            console.error("Lỗi API tỷ giá:", rateError);
            res.status(503).json({ message: "Lỗi dịch vụ tỷ giá hối đoái." });
            return;
        }
        
        console.log(`[Category Stats] Base: ${APP_BASE_CURRENCY}, Target: ${targetCurrency}, Rate: ${conversionRate}`);

        // 6. Chuẩn hóa ngày tháng theo UTC
        const gteDate = getStartOfDay(startDate as string);
        const lteDate = getEndOfDay(endDate as string);

        // 7. Thực hiện Aggregation
        const aggregationResult = await Transaction.aggregate([
            {
                // Giai đoạn 1: Lọc giao dịch
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    type: type, 
                    date: { $gte: gteDate, $lte: lteDate },
                },
            },
            {
                // Giai đoạn 2: Nhóm và CHỈ TÍNH TỔNG baseAmount (VND)
                $group: {
                    _id: "$category",
                    // Tính tổng giá trị đã quy đổi về VND (Base)
                    baseAmount: { 
                        $sum: { 
                            $multiply: [
                                "$amount",
                                { $ifNull: ["$exchangeRate", 1] } 
                            ]
                        } 
                    },
                },
            },
            {
                // Giai đoạn 3: Tính displayAmount từ baseAmount
                $project: {
                    _id: 0, // Bỏ trường _id
                    category: "$_id", // Đổi tên _id thành category
                    baseAmount: "$baseAmount", // Giữ lại baseAmount đã tính
                    // Tính displayAmount bằng cách nhân
                    displayAmount: { $multiply: ["$baseAmount", conversionRate] }
                }
            },
            {
                // Giai đoạn 4: Sắp xếp
                $sort: { baseAmount: -1 } // Sắp xếp theo baseAmount
            }
        ]);

        // 8. Chuẩn hóa kết quả
        const stats = aggregationResult
            .filter(item => item.baseAmount > 0) 
            .map(item => ({
                category: item.category,
                // Làm tròn 2 chữ số thập phân
                baseAmount: Number(item.baseAmount.toFixed(2)), 
                displayAmount: Number(item.displayAmount.toFixed(2)),
            }));

        // 9. Trả về object chứa stats và currency (của displayAmount)
        res.status(200).json({
            stats: stats,
            currency: targetCurrency 
        });

    } catch (error) {
        console.error("❌ Lỗi khi lấy Category Stats:", error);
        res.status(500).json({ message: "Không thể lấy thống kê danh mục", error });
    }
};

/**
 * [GET] /api/stats/trend
 * Lấy dữ liệu chuỗi thời gian (time series) cho income hoặc expense,
 * nhóm theo tháng/năm.
 */
export const getTrendStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    // 1. Lấy params từ query
    const {
      startDate,
      endDate,
      type, // 'income' hoặc 'expense'
      currency: targetCurrencyQuery,
    } = req.query;

    if (!userId || !startDate || !endDate || !type) {
      res.status(400).json({ message: "Thiếu các tham số bắt buộc." });
      return;
    }

    // --- BẮT ĐẦU LOGIC TIỀN TỆ (Giống hệt getDashboardStats) ---

    // 2. Tiền tệ cơ sở của CSDL (Database) LUÔN là VND
    const APP_BASE_CURRENCY = "VND";

    // 3. Lấy tiền tệ mặc định MÀ USER MUỐN XEM
    const user = await User.findById(userId).select("currency").lean();
    const userPreferredCurrency = user?.currency || APP_BASE_CURRENCY;

    // 4. Xác định tiền tệ mục tiêu (target currency)
    const targetCurrency =
      (targetCurrencyQuery as string) || userPreferredCurrency;

    // 5. Lấy tỷ giá quy đổi
    let conversionRate = 1.0;
    try {
      conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);
    } catch (rateError) {
      console.error("Lỗi API tỷ giá:", rateError);
      res.status(503).json({ message: "Lỗi dịch vụ tỷ giá hối đoái." });
      return;
    }
    
    console.log(
      `[Trend Stats] Base: ${APP_BASE_CURRENCY}, Target: ${targetCurrency}, Rate: ${conversionRate}`
    );

    // --- KẾT THÚC LOGIC TIỀN TỆ ---

    // 6. Xử lý Date
    const gteDate = new Date(startDate as string);
    gteDate.setUTCHours(0, 0, 0, 0);
    const lteDate = getEndOfDay(endDate as string);

    // 7. ⭐️ AGGREGATION MỚI (CHỈ 1 LẦN GỌI) ⭐️
    const trendResult = await Transaction.aggregate([
      {
        // Giai đoạn 1: Lọc giao dịch
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          type: type as string,
          date: { $gte: gteDate, $lte: lteDate },
        },
      },
      {
        // Giai đoạn 2: Nhóm theo Năm và Tháng
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
          },
          // Tính tổng (đã quy đổi) cho mỗi nhóm
          total: {
            $sum: {
              $multiply: [
                {
                  $multiply: [
                    "$amount",
                    { $ifNull: ["$exchangeRate", 1] }, // 1. Đổi về VND
                  ],
                },
                conversionRate, // 2. Đổi từ VND sang Target
              ],
            },
          },
        },
      },
      {
        // Giai đoạn 3: Sắp xếp theo thời gian
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
      {
        // Giai đoạn 4: Định dạng lại output cho đẹp
        $project: {
          _id: 0,
          total: { $round: ["$total", 2] }, // Làm tròn 2 chữ số
          // Tạo trường 'period' dạng "YYYY-MM"
          period: {
            $dateToString: {
              format: "%Y-%m",
              date: {
                $dateFromParts: {
                  year: "$_id.year",
                  month: "$_id.month",
                  day: 1,
                },
              },
            },
          },
        },
      },
    ]);

    // 8. Trả về kết quả
    res.status(200).json({
      trend: trendResult, // Mảng [{ period: "2025-10", total: 1500000 }, ...]
      currency: targetCurrency,
    });
  } catch (error) {
    console.error("❌ Lỗi khi lấy Trend Stats:", error);
    res.status(500).json({ message: "Không thể lấy dữ liệu Trend", error });
  }
};

/**
 * [GET] /api/stats/forecast
 * Dự đoán tổng chi tiêu cho tháng hiện tại dựa trên tốc độ chi tiêu.
 */
export const getSpendingForecast = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    
    // --- 1. LẤY LOGIC TIỀN TỆ (Giống dashboard) ---
    const APP_BASE_CURRENCY = "VND";
    const user = await User.findById(userId).select("currency").lean();
    const targetCurrency = user?.currency || APP_BASE_CURRENCY;
    const conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);

    // --- 2. LẤY LOGIC THỜI GIAN (CHO THÁNG HIỆN TẠI) ---
    const today = new Date();
    // Ví dụ: 2025-11-01 (Ngày đầu tháng)
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1); 
    // Ví dụ: 2025-11-30 (Ngày cuối tháng)
    const endDateOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); 
    
    // Số ngày đã qua (ví dụ: hôm nay 10/11 -> 10 ngày)
    const daysSoFar = today.getDate();
    // Tổng số ngày trong tháng (ví dụ: 30 ngày)
    const totalDaysInMonth = endDateOfMonth.getDate();
    // Số ngày còn lại (ví dụ: 30 - 10 = 20 ngày)
    const daysRemaining = totalDaysInMonth - daysSoFar;

    // --- 3. TÍNH TOÁN (CORE) ---
    
    // a. Lấy tổng chi tiêu TỪ ĐẦU THÁNG ĐẾN HÔM NAY
    const summary = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          type: "expense",
          date: { $gte: startDate, $lte: today }, // Chỉ tính đến hôm nay
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: [ /*... logic quy đổi tiền tệ ...*/ ] } },
        },
      },
    ]);

    const currentSpent = summary.length > 0 ? summary[0].total : 0;

    // b. Tính trung bình chi tiêu mỗi ngày
    const dailyAverage = (daysSoFar > 0) ? (currentSpent / daysSoFar) : 0;

    // c. Dự đoán
    const forecastedRemaining = dailyAverage * daysRemaining;
    const forecastedTotal = currentSpent + forecastedRemaining;

    // d. (Bonus) Lấy ngân sách để so sánh
    const budget = await Budget.findOne({ userId, month: today.getMonth() + 1, year: today.getFullYear() });
    const totalBudget = budget ? (budget.originalAmount * conversionRate) : 0;

    // --- 4. TRẢ VỀ ---
    res.status(200).json({
      currency: targetCurrency,
      currentSpent: currentSpent.toFixed(2),         // Đã chi (đến hôm nay)
      dailyAverage: dailyAverage.toFixed(2),       // Trung bình/ngày
      forecastedTotal: forecastedTotal.toFixed(2), // Dự đoán tổng chi
      totalBudget: totalBudget.toFixed(2),         // Ngân sách
      daysRemaining: daysRemaining,
    });

  } catch (error) {
    console.error("❌ Lỗi khi lấy Forecast:", error);
    res.status(500).json({ message: "Không thể lấy dữ liệu dự đoán", error });
  }
};