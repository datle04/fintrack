// src/controllers/goal.controller.ts

import { Response } from 'express';
import Goal, { IGoal } from '../models/Goal';
import { AuthRequest } from '../middlewares/requireAuth';
import { getConversionRate } from '../services/exchangeRate';
import Transaction from '../models/Transaction';
import mongoose from 'mongoose';

const APP_BASE_CURRENCY = 'VND';

/* ============================================================
 * 🔹 Helper: Tính tiến độ mục tiêu
 * ============================================================ */
const calculateProgress = (currentBase: number, targetBase: number): number =>
  targetBase > 0 ? Math.min((currentBase / targetBase) * 100, 100) : 0;

/* ============================================================
 * 🔹 Helper: Tính kế hoạch tiết kiệm
 * ============================================================ */
const calculateSavingsPlan = (remainingBaseAmount: number, targetDate: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0 || remainingBaseAmount <= 0) {
    return {
      recommendedDaily: 0,
      recommendedWeekly: 0,
      recommendedMonthly: 0,
      daysRemaining: Math.max(daysRemaining, 0),
    };
  }

  const weeksRemaining = daysRemaining / 7;
  const monthsRemaining = daysRemaining / (365.25 / 12);

  return {
    recommendedDaily: remainingBaseAmount / daysRemaining,
    recommendedWeekly: remainingBaseAmount / weeksRemaining,
    recommendedMonthly: remainingBaseAmount / monthsRemaining,
    daysRemaining,
  };
};

/* ============================================================
 * 🔹 Helper: Bổ sung dữ liệu hiển thị cho Goal
 * ============================================================ */
const enhanceGoalResponse = (goal: IGoal) => {
  const progressPercent = calculateProgress(goal.currentBaseAmount, goal.targetBaseAmount);
  const remainingBaseAmount = goal.targetBaseAmount - goal.currentBaseAmount;
  const basePlan = calculateSavingsPlan(remainingBaseAmount, goal.targetDate);

  const rate = goal.creationExchangeRate || 1; // Target → VND

  const toDisplay = (v: number) => Math.max(v / rate, 0);

  return {
    ...goal.toObject(),
    progressPercent,
    displayCurrentAmount: toDisplay(goal.currentBaseAmount),
    displayRemainingAmount: toDisplay(remainingBaseAmount),
    savingsPlan: {
      recommendedDaily: toDisplay(basePlan.recommendedDaily),
      recommendedWeekly: toDisplay(basePlan.recommendedWeekly),
      recommendedMonthly: toDisplay(basePlan.recommendedMonthly),
      daysRemaining: basePlan.daysRemaining,
    },
  };
};

/* ============================================================
 * 🔹 Controller: Tạo mục tiêu
 * ============================================================ */
export const createGoal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    const { name, targetOriginalAmount, targetCurrency, targetDate, description } = req.body;

    let targetBaseAmount = targetOriginalAmount;
    let creationExchangeRate = 1;

    if (targetCurrency && targetCurrency !== APP_BASE_CURRENCY) {
      try {
        const rate = await getConversionRate(targetCurrency, APP_BASE_CURRENCY);
        targetBaseAmount = targetOriginalAmount * rate;
        creationExchangeRate = rate;
      } catch (err) {
        console.error('Lỗi API tỷ giá:', err);
        res.status(503).json({ message: 'Lỗi dịch vụ tỷ giá hối đoái.' });
        return;
      }
    }

    const newGoal = await Goal.create({
      userId,
      name,
      targetDate,
      description,
      targetOriginalAmount,
      targetCurrency: targetCurrency || APP_BASE_CURRENCY,
      targetBaseAmount,
      creationExchangeRate,
      currentBaseAmount: 0,
      isCompleted: false,
    });

    res.status(201).json(enhanceGoalResponse(newGoal));
  } catch (error) {
    res.status(500).json({ message: 'Error creating goal', error });
  }
};

/* ============================================================
 * 🔹 Controller: Lấy danh sách mục tiêu
 * ============================================================ */
export const getGoals = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    const goals = await Goal.find({ userId }).sort({ targetDate: 1 });
    res.status(200).json(goals.map(enhanceGoalResponse));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching goals', error });
  }
};

/* ============================================================
 * 🔹 Controller: Cập nhật mục tiêu
 * ============================================================ */
export const updateGoal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    const { name, description, targetDate, isCompleted, targetOriginalAmount } = req.body;
    
    // 1. Tìm Goal trước
    const goal = await Goal.findOne({ _id: req.params.id, userId });
    if (!goal) {
        res.status(404).json({ message: 'Goal not found' });
        return;
    }

    // 2. Cập nhật các trường thông thường
    if (name) goal.name = name;
    if (description) goal.description = description;
    if (targetDate) goal.targetDate = targetDate;
    if (isCompleted !== undefined) goal.isCompleted = isCompleted;

    // 3. 🔥 LOGIC MỚI: Xử lý thay đổi số tiền mục tiêu (Nếu có)
    if (targetOriginalAmount && targetOriginalAmount !== goal.targetOriginalAmount) {
        // Tính lại targetBaseAmount dựa trên tỷ giá lúc tạo (để nhất quán)
        // Hoặc lấy tỷ giá mới nếu muốn (nhưng phức tạp hơn)
        // Ở đây ta dùng tỷ giá lúc tạo (creationExchangeRate)
        const rate = goal.creationExchangeRate || 1;
        goal.targetOriginalAmount = targetOriginalAmount;
        goal.targetBaseAmount = targetOriginalAmount * rate;
    }

    const updatedGoal = await goal.save();

    res.status(200).json(enhanceGoalResponse(updatedGoal));
  } catch (error) {
    res.status(500).json({ message: 'Error updating goal', error });
  }
};

/* ============================================================
 * 🔹 Controller: Xóa mục tiêu
 * ============================================================ */
export const deleteGoal = async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession(); // Dùng Transaction cho an toàn
  session.startTransaction();

  try {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    // 1. Tìm và xóa Goal
    const deletedGoal = await Goal.findOneAndDelete({ _id: req.params.id, userId }).session(session);

    if (!deletedGoal) {
        await session.abortTransaction();
        res.status(404).json({ message: 'Goal not found' });
        return;
    }

    // 2. 🔥 XỬ LÝ GIAO DỊCH LIÊN QUAN (Quan trọng)
    
    // A. Với các giao dịch ĐÃ thực hiện: Giữ lại nhưng ngắt liên kết (set goalId = null)
    // Để không làm mất lịch sử chi tiêu của user
    await Transaction.updateMany(
        { user: userId, goalId: deletedGoal._id },
        { $set: { goalId: null, note: `(Mục tiêu "${deletedGoal.name}" đã bị xóa)` } } // Thêm note để user biết
    ).session(session);

    // B. Với các Recurring Template (Giao dịch định kỳ) đang trỏ vào Goal này:
    // Cần HỦY hoặc CẬP NHẬT để nó không tiếp tục chạy vô định
    await Transaction.updateMany(
        { user: userId, goalId: deletedGoal._id, isRecurring: true, date: null }, // Template recurring
        { $set: { isRecurring: false, goalId: null } } // Tắt recurring luôn
    ).session(session);

    await session.commitTransaction();
    res.status(200).json({ message: 'Goal deleted and transactions unlinked successfully' });

  } catch (error) {
    await session.abortTransaction();
    console.error("Delete Goal Error:", error);
    res.status(500).json({ message: 'Error deleting goal', error });
  } finally {
    session.endSession();
  }
};
