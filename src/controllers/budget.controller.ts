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

export const processBudgetData = async (data: any) => {
  const originalCurrency = (data.currency || 'VND').toUpperCase();
  const originalTotalAmount = Number(data.totalAmount);
  const originalCategories = data.categories || [];

  let exchangeRate = 1;
  if (originalCurrency !== 'VND') {
      exchangeRate = await getExchangeRate(originalCurrency);
  }
  
  const convertedTotalAmount = originalTotalAmount * exchangeRate;

  const convertedCategories = originalCategories.map((cat: any) => {
    return {
        category: cat.category,
        amount: Number(cat.amount) * exchangeRate, 
        alertLevel: cat.alertLevel || 0,
    };
  });

  return {
      originalAmount: originalTotalAmount,
      originalCurrency,
      convertedTotalAmount,
      convertedCategories,
      exchangeRate, 
  };
}

export const setOrUpdateBudget = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { month, year, originalAmount, originalCurrency, categories } = req.body; 
    
    console.log("[MONTH]: ", month);
    console.log("[YEAR]: ", year);
    console.log("[ORIGINAL AMOUNT]: ", originalAmount);
    console.log("[ORIGINAL CURRENCY]: ", originalCurrency);
    console.log("[CATEGORIES]: ", categories);

    const categoriesForHelper = categories.map((cat: any) => ({
        ...cat,
        amount: cat.originalAmount ?? cat.amount 
    }));

    const processed = await processBudgetData({ 
        currency: originalCurrency, 
        totalAmount: originalAmount, 
        categories: categoriesForHelper 
    });

    const convertedCategoriesMap = new Map(
      (processed.convertedCategories || []).map((cat: any) => [cat.category, cat.amount])
    );

    const finalCategories = categories?.map((reqCategory: any) => ({
      category: reqCategory.category,
      originalAmount: reqCategory.originalAmount ?? reqCategory.amount, 
      amount: convertedCategoriesMap.get(reqCategory.category) || 0, 
      alertLevel: 0 
    }));

    const budget = await Budget.findOneAndUpdate(
      { user: userId, month, year },
      {
        $set: {
          originalAmount: processed.originalAmount,  
          originalCurrency: processed.originalCurrency, 
          
          totalAmount: processed.convertedTotalAmount, 
          currency: 'VND', 
          exchangeRate: processed.exchangeRate || 1, 
          categories: finalCategories,
          alertLevel: 0 
        }
      },
      { 
        new: true,   
        upsert: true, 
        setDefaultsOnInsert: true 
      }
    );

    await checkBudgetAlertForUser(userId);

    await logAction(req, {
      action: "setOrUpdateBudget",
      statusCode: 200,
      description: `Đã thiết lập ngân sách tháng ${month}/${year}`,
    });

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

    const m = Number(month);
    const y = Number(year);
    const start = getStartOfMonth(y, m);
    const end = getEndOfMonth(y, m);

    const budgetDoc = await Budget.findOne({ user: userId, month, year });

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

    const actualSpending = await getRawSpendingByCategory(userId, start, end);

    const realTotalSpent = actualSpending.reduce((sum, item) => sum + item.spentAmount, 0);

    const categoryStats = budgetDoc.categories.map((budgetCat) => {
      const found = actualSpending.find((s) => s._id === budgetCat.category);
      const spent = found?.spentAmount || 0;
      
      const percent = budgetCat.amount > 0 ? (spent / budgetCat.amount) * 100 : 0;

      return {
        category: budgetCat.category,
        originalBudgetedAmount: budgetCat.originalAmount,
        budgetedAmount: budgetCat.amount,
        spentAmount: spent, 
        percentUsed: percent > 100 ? 100 : Number(percent.toFixed(1)),
      };
    });

    const totalBudget = budgetDoc.totalAmount;
    const totalPercent = totalBudget > 0 ? (realTotalSpent / totalBudget) * 100 : 0;

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
    const userId = req.userId!; 
    const { month, year } = req.query;

    if (!month || !year) {
      res.status(400).json({ message: 'Vui lòng cung cấp tháng và năm để xóa.' });
      return;
    }

    const deletedBudget = await Budget.findOneAndDelete({
      user: userId,
      month: Number(month),
      year: Number(year),
    });

    if (!deletedBudget) {
      res.status(404).json({ message: `Không tìm thấy ngân sách tháng ${month}/${year} để xóa.` });
      return;
    }

    await logAction(req, {
      action: "deleteBudget",
      statusCode: 200,
      description: `User xóa ngân sách tháng ${month}/${year} (Tổng: ${deletedBudget.totalAmount} VND)`,
    });

    res.status(200).json({
      message: `Đã xóa ngân sách tháng ${month}/${year} thành công.`,
      deletedBudget, 
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