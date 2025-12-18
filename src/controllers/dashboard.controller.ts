import { AuthRequest } from "../middlewares/requireAuth";
import { Request, Response } from 'express';
import { getEndOfDay } from "../utils/dateHelper";
import Transaction from "../models/Transaction";
import mongoose from "mongoose";
import User from "../models/User";
import { getConversionRate, getExchangeRate } from "../services/exchangeRate";
import { calculateTotalStats } from "../services/statistics.service";


// [GET] /api/dashboard
export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { startDate, endDate, currency } = req.query;

    if (!startDate || !endDate) {
        res.status(400).json({ message: "Thiếu startDate hoặc endDate" });
        return;
    }

    let targetCurrency = currency as string;
    if (!targetCurrency) {
      const user = await User.findById(userId).select("currency").lean();
      targetCurrency = user?.currency || "VND";
    }

    const start = new Date(startDate as string);
    start.setUTCHours(0, 0, 0, 0);
    const end = getEndOfDay(endDate as string);

    const stats = await calculateTotalStats(userId, start, end, targetCurrency);

    res.status(200).json({
      totalIncome: stats.income.toFixed(2),
      totalExpense: stats.expense.toFixed(2),
      balance: stats.balance.toFixed(2),
      currency: stats.currency,
    });

  } catch (error) {
    console.error("❌ Dashboard Error:", error);
    res.status(500).json({ message: "Lỗi lấy dữ liệu Dashboard" });
  }
};

export const getDashboardByMonths = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const currentYear = new Date().getFullYear();

    const monthlyStats = await Promise.all(
    Array.from({ length: 12 }, async (_, month) => {
        const start = new Date(Date.UTC(currentYear, month, 1));
        const end = new Date(Date.UTC(currentYear, month + 1, 1));

        const transactions = await Transaction.find({
        user: userId,
        date: { $gte: start, $lt: end },
        });

        const income = transactions
        .filter((tx) => tx.type === "income")
        .reduce((sum, tx) => sum + tx.amount, 0);

        const expense = transactions
        .filter((tx) => tx.type === "expense")
        .reduce((sum, tx) => sum + tx.amount, 0);

        return {
        month: month + 1,
        income,
        expense,
        balance: income - expense,
        };
    })
    );
    res.json(monthlyStats);

  } catch (error) {
    console.error("Error in getDashboardByMonths:", error);
    res.status(500).json({ message: "Không thể lấy thống kê theo tháng", error });
  }
};