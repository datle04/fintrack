// src/controllers/goal.controller.ts

import { Response } from 'express';
import Goal, { IGoal } from '../models/Goal';
import { AuthRequest } from '../middlewares/requireAuth';
import { getConversionRate } from '../services/exchangeRate';
import Transaction from '../models/Transaction';

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
    const userId = req.user?._id;
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
    const userId = req.user?._id;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    const { name, description, targetDate, isCompleted } = req.body;
    const updateData: Partial<IGoal> = {};

    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (targetDate) updateData.targetDate = targetDate;
    if (isCompleted !== undefined) updateData.isCompleted = isCompleted;

    const updatedGoal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updateData },
      { new: true }
    );

    if (!updatedGoal){
        res.status(404).json({ message: 'Goal not found or unauthorized' });
        return;
    } 

    res.status(200).json(enhanceGoalResponse(updatedGoal));
  } catch (error) {
    res.status(500).json({ message: 'Error updating goal', error });
  }
};

/* ============================================================
 * 🔹 Controller: Xóa mục tiêu
 * ============================================================ */
export const deleteGoal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    const deletedGoal = await Goal.findOneAndDelete({ _id: req.params.id, userId });

    await Transaction.updateMany(
        { userId: userId, goalId: deletedGoal?._id, date: undefined},
        { $set: { goalId: null }}
    )

    if (!deletedGoal){
        res.status(404).json({ message: 'Goal not found or unauthorized' });
        return;
    } 

    // TODO: Optional - cập nhật các Transaction liên kết với goal này
    // await Transaction.updateMany({ userId, goalId: deletedGoal._id }, { $set: { goalId: null } });

    res.status(200).json({ message: 'Goal deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting goal', error });
  }
};
