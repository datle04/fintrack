import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';    
import Transaction from '../models/Transaction';      
import User from '../models/User';                
import { getStartOfDay, getEndOfDay } from '../utils/dateHelper';
import { getConversionRate } from '../services/exchangeRate';
import Budget from '../models/Budget';
import { calculateCategoryStats } from '../services/statistics.service';

// [GET] /api/stats/category-stats
export const getCategoryStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { type = "expense", startDate, endDate, currency } = req.query;

    if (!startDate || !endDate) {
       res.status(400).json({ message: "Thiếu startDate, endDate." });
       return;
    }

    let targetCurrency = currency as string;
    if (!targetCurrency) {
      const user = await User.findById(userId).select("currency").lean();
      targetCurrency = user?.currency || "VND";
    }

    const start = getStartOfDay(startDate as string);
    const end = getEndOfDay(endDate as string);

    const { stats } = await calculateCategoryStats(
      userId, 
      start, 
      end, 
      type as string, 
      targetCurrency
    );

    const formattedStats = stats
        .filter((item: any) => item.baseAmount > 0)
        .map((item: any) => ({
            category: item.category,
            baseAmount: Number(item.baseAmount.toFixed(2)),
            displayAmount: Number(item.displayAmount.toFixed(2)),
        }));

    res.status(200).json({
      stats: formattedStats,
      currency: targetCurrency,
    });

  } catch (error) {
    console.error("❌ Category Stats Error:", error);
    res.status(500).json({ message: "Lỗi thống kê danh mục" });
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

    const {
      startDate,
      endDate,
      type, 
      currency: targetCurrencyQuery,
    } = req.query;

    if (!userId || !startDate || !endDate || !type) {
      res.status(400).json({ message: "Thiếu các tham số bắt buộc." });
      return;
    }

    const APP_BASE_CURRENCY = "VND";

    const user = await User.findById(userId).select("currency").lean();
    const userPreferredCurrency = user?.currency || APP_BASE_CURRENCY;

    const targetCurrency =
      (targetCurrencyQuery as string) || userPreferredCurrency;

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

    const gteDate = new Date(startDate as string);
    gteDate.setUTCHours(0, 0, 0, 0);
    const lteDate = getEndOfDay(endDate as string);

    const trendResult = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          type: type as string,
          date: { $gte: gteDate, $lte: lteDate },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
          },
          total: {
            $sum: {
              $multiply: [
                {
                  $multiply: [
                    "$amount",
                    { $ifNull: ["$exchangeRate", 1] },
                  ],
                },
                conversionRate, 
              ],
            },
          },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
      {
        $project: {
          _id: 0,
          total: { $round: ["$total", 2] },
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

    res.status(200).json({
      trend: trendResult, 
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

    const APP_BASE_CURRENCY = "VND";
    const user = await User.findById(userId).select("currency").lean();
    const targetCurrency = user?.currency || APP_BASE_CURRENCY;
    const conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);

    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1); 
    const endDateOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); 
 
    const daysSoFar = today.getDate();
    const totalDaysInMonth = endDateOfMonth.getDate();
    const daysRemaining = totalDaysInMonth - daysSoFar;

    const summary = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          type: "expense",
          date: { $gte: startDate, $lte: today }, 
        },
      },
      {
      $group: {
        _id: null,
        total: {
          $sum: {
            $multiply: [
              { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
              conversionRate 
            ]
          }
        },
      },
      },
    ]);

    const currentSpent = summary.length > 0 ? summary[0].total : 0;

    const dailyAverage = (daysSoFar > 0) ? (currentSpent / daysSoFar) : 0;
    const forecastedRemaining = dailyAverage * daysRemaining;
    const forecastedTotal = currentSpent + forecastedRemaining;

    const budget = await Budget.findOne({ userId, month: today.getMonth() + 1, year: today.getFullYear() });
    const totalBudget = budget ? (budget.originalAmount * conversionRate) : 0;

    res.status(200).json({
      currency: targetCurrency,
      currentSpent: currentSpent.toFixed(2),         
      dailyAverage: dailyAverage.toFixed(2),       
      forecastedTotal: forecastedTotal.toFixed(2), 
      totalBudget: totalBudget.toFixed(2),         
      daysRemaining: daysRemaining,
    });

  } catch (error) {
    console.error("❌ Lỗi khi lấy Forecast:", error);
    res.status(500).json({ message: "Không thể lấy dữ liệu dự đoán", error });
  }
};