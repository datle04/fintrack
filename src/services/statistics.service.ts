import mongoose from "mongoose";
import Transaction from "../models/Transaction";
import { getConversionRate } from "./exchangeRate";

/**
 * 1. Tính Tổng Thu / Chi / Balance (Có quy đổi tiền tệ)
 * Dùng cho: Dashboard, Financial Health
 */
export const calculateTotalStats = async (
  userId: string,
  startDate: Date,
  endDate: Date,
  targetCurrency: string
) => {
  const conversionRate = await getConversionRate("VND", targetCurrency);

  const summary = await Transaction.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$type",
        total: {
          $sum: {
            $multiply: [
              { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] }, // Đổi về VND
              conversionRate, // Đổi sang Target
            ],
          },
        },
      },
    },
  ]);

  const income = summary.find((s) => s._id === "income")?.total || 0;
  const expense = summary.find((s) => s._id === "expense")?.total || 0;

  return {
    income,
    expense,
    balance: income - expense,
    currency: targetCurrency,
  };
};

/**
 * 2. Tính Thống kê theo Danh mục (Có quy đổi tiền tệ & Sắp xếp)
 * Dùng cho: Category Stats Chart, Top Spending Advice
 */
export const calculateCategoryStats = async (
  userId: string,
  startDate: Date,
  endDate: Date,
  type: string, // 'income' hoặc 'expense'
  targetCurrency: string,
  limit: number = 0 // 0 = Lấy hết, > 0 = Limit (ví dụ top 3)
) => {
  const conversionRate = await getConversionRate("VND", targetCurrency);

  const pipeline: any[] = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        type: type,
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$category",
        // Tính Base Amount (VND)
        baseAmount: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
    // Tính Display Amount (Target Currency)
    {
      $project: {
        _id: 0,
        category: "$_id",
        baseAmount: 1,
        displayAmount: { $multiply: ["$baseAmount", conversionRate] },
      },
    },
    { $sort: { baseAmount: -1 } },
  ];

  // Nếu có limit thì thêm vào pipeline
  if (limit > 0) {
    pipeline.push({ $limit: limit });
  }

  // Nếu Category là ObjectId, bạn có thể thêm $lookup ở đây để lấy tên
  // (Giả sử code cũ của bạn category lưu string hoặc đã lookup)
  
  const stats = await Transaction.aggregate(pipeline);
  return { stats, conversionRate };
};

/**
 * 3. Lấy chi tiêu thực tế từng danh mục (Raw VND)
 * Dùng riêng cho: Budget Calculation (để so sánh với ngân sách gốc)
 */
export const getRawSpendingByCategory = async (
  userId: string,
  startDate: Date,
  endDate: Date
) => {
  return await Transaction.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        type: "expense",
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$category",
        spentAmount: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
  ]);
};