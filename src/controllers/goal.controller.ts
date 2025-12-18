// src/controllers/goal.controller.ts

import { Response } from 'express';
import Goal, { IGoal } from '../models/Goal';
import { AuthRequest } from '../middlewares/requireAuth';
import { getConversionRate } from '../services/exchangeRate';
import Transaction from '../models/Transaction';
import mongoose from 'mongoose';
import { logAction } from '../utils/logAction';

const APP_BASE_CURRENCY = 'VND';

// Helper: Tính tiến độ mục tiêu
const calculateProgress = (currentBase: number, targetBase: number): number =>
  targetBase > 0 ? Math.min((currentBase / targetBase) * 100, 100) : 0;

// Helper: Tính kế hoạch tiết kiệm
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

// Bổ sung dữ liệu hiển thị cho Goal
const enhanceGoalResponse = (goal: IGoal) => {
  const progressPercent = calculateProgress(goal.currentBaseAmount, goal.targetBaseAmount);
  const remainingBaseAmount = goal.targetBaseAmount - goal.currentBaseAmount;
  const basePlan = calculateSavingsPlan(remainingBaseAmount, goal.targetDate);

  const rate = goal.creationExchangeRate || 1;

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


// CREATE GOAL
export const createGoal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { name, targetOriginalAmount, targetCurrency, targetDate, description, status } = req.body;

    let targetBaseAmount = targetOriginalAmount;
    let creationExchangeRate = 1;

    // Xử lý tỷ giá nếu khác tiền tệ gốc
    if (targetCurrency && targetCurrency !== APP_BASE_CURRENCY) {
      try {
        const rate = await getConversionRate(targetCurrency, APP_BASE_CURRENCY);
        targetBaseAmount = targetOriginalAmount * rate;
        creationExchangeRate = rate;
      } catch (err) {
        console.error('Lỗi API tỷ giá:', err);
        res.status(503).json({ message: 'Không thể lấy tỷ giá hối đoái lúc này.' });
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
      status: status || 'in_progress',
      isCompleted: status === 'completed' ? true : false, 
    });

    await logAction(req, {
        action: "Create Goal",
        statusCode: 201,
        description: `Tạo mục tiêu: ${name}`,
    });

    res.status(201).json(enhanceGoalResponse(newGoal));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi khi tạo mục tiêu', error });
  }
};

// GET GOALS
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

export const updateGoal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    
    const { 
        name, description, targetDate, 
        status, isCompleted,
        targetOriginalAmount, targetCurrency 
    } = req.body;
    
    const goal = await Goal.findOne({ _id: id, userId });
    if (!goal) {
        res.status(404).json({ message: 'Mục tiêu không tồn tại' });
        return;
    }

    if (name !== undefined) goal.name = name;
    if (description !== undefined) goal.description = description;
    if (targetDate !== undefined) goal.targetDate = targetDate;
    
    let newStatus = status;

    if (!newStatus && isCompleted !== undefined) {
        if (isCompleted === true) newStatus = 'completed';
        if (isCompleted === false && goal.status === 'completed') newStatus = 'in_progress';
    }

    if (newStatus) {
        goal.status = newStatus;
    }

    const isAmountChanged = targetOriginalAmount !== undefined && targetOriginalAmount !== goal.targetOriginalAmount;
    const isCurrencyChanged = targetCurrency !== undefined && targetCurrency !== goal.targetCurrency;

    if (isAmountChanged || isCurrencyChanged) {
        const newAmount = targetOriginalAmount !== undefined ? targetOriginalAmount : goal.targetOriginalAmount;
        const newCurrency = targetCurrency !== undefined ? targetCurrency : goal.targetCurrency;

        if (isCurrencyChanged) {
            if (newCurrency !== APP_BASE_CURRENCY) {
                try {
                    const rate = await getConversionRate(newCurrency, APP_BASE_CURRENCY);
                    goal.creationExchangeRate = rate; 
                    goal.targetBaseAmount = newAmount * rate;
                } catch (err) {
                    res.status(503).json({ message: "Lỗi cập nhật tỷ giá." });
                    return;
                }
            } else {
                goal.creationExchangeRate = 1;
                goal.targetBaseAmount = newAmount;
            }
        } 

        else {
            const rate = goal.creationExchangeRate || 1;
            goal.targetBaseAmount = newAmount * rate;
        }

        goal.targetOriginalAmount = newAmount;
        goal.targetCurrency = newCurrency;
    }

    if (!newStatus) {
        if (goal.currentBaseAmount >= goal.targetBaseAmount) {
            if (goal.status === 'in_progress') {
                goal.status = 'completed';
            }
        } else {
            if (goal.status === 'completed') {
                goal.status = 'in_progress';
            }
        }
    }
    const updatedGoal = await goal.save();

    await logAction(req, {
        action: "Update Goal",
        statusCode: 200,
        description: `Cập nhật mục tiêu ID: ${id}`,
    });

    res.status(200).json(enhanceGoalResponse(updatedGoal));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi khi cập nhật mục tiêu', error });
  }
};

export const deleteGoal = async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.userId;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    } 

    const deletedGoal = await Goal.findOneAndDelete({ _id: req.params.id, userId }).session(session);

    if (!deletedGoal) {
        await session.abortTransaction();
        res.status(404).json({ message: 'Goal not found' });
        return;
    }

    await Transaction.updateMany(
        { user: userId, goalId: deletedGoal._id },
        { $set: { goalId: null, note: `(Mục tiêu "${deletedGoal.name}" đã bị xóa)` } } 
    ).session(session);

    await Transaction.updateMany(
        { user: userId, goalId: deletedGoal._id, isRecurring: true, date: null }, 
        { $set: { isRecurring: false, goalId: null } } 
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
