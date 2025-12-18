import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import Transaction, { ITransaction } from '../models/Transaction';
import cloudinary from '../utils/cloudinary';
import { v4 as uuid } from 'uuid';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';
import { logAction } from '../utils/logAction';
import { checkBudgetAlertForUser } from '../services/budget.service';
import { getExchangeRate } from '../services/exchangeRate'; 
import mongoose, { Types } from 'mongoose';
import axios from "axios";
import Goal from '../models/Goal';
import { recalculateGoalProgress, updateGoalProgress } from '../services/goal.service';

// Hàm xử lý chung để lấy tỷ giá và chuẩn bị dữ liệu giao dịch
export const processTransactionData = async (data: any) => {
    const transactionCurrency = (data.currency || 'VND').toUpperCase();
    let exchangeRate = 1;

    if (transactionCurrency !== 'VND') {
        exchangeRate = await getExchangeRate(transactionCurrency);
    }

    return {
        ...data,
        currency: transactionCurrency,
        exchangeRate: exchangeRate,
    };
}


// CREATE
export const createTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
    try {

      console.log("📂 Files received:", req.files);
      console.log("📝 Body received:", req.body);

        const {
            amount,
            type,
            category,
            note,
            date,
            recurringDay,
            isRecurring,
            currency, 
            goalId,
        } = req.body;

        if (amount < 0) {
            res.status(400).json({ message: "Số tiền không hợp lệ!" });
            return;
        }

        const { exchangeRate, currency: finalCurrency } = await processTransactionData({ currency, amount });
        
        let receiptImages: string[] = [];
        if (req.files && Array.isArray(req.files)) {
            const uploadPromises = (req.files as Express.Multer.File[]).map(file => {
                const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
                return cloudinary.uploader.upload(base64, {
                    folder: 'fintrack_receipts',
                    public_id: `receipt-${uuid()}`
                });
            });

            const results = await Promise.all(uploadPromises);
            receiptImages = results.map(result => result.secure_url);
        }

        const isRecurringBool = isRecurring === 'true' || isRecurring === true;

        if (isRecurringBool) {
            if (!recurringDay || recurringDay < 1 || recurringDay > 31) {
                res.status(400).json({ message: "Ngày định kỳ (recurringDay) không hợp lệ" });
                return;
            }

            const recurringId = uuid();

            const commonFields = {
                user: req.userId,
                amount,
                type,
                category,
                note,
                receiptImage: receiptImages,
                isRecurring: true,
                recurringDay,
                recurringId,
                currency: finalCurrency,
                exchangeRate,
                goalId: goalId || null
            };

            const templateTx = await Transaction.create({ ...commonFields, date: undefined });

            const firstTx = await Transaction.create({ 
                ...commonFields, 
                date: new Date(date) 
            });

             if (firstTx.goalId) {
                await recalculateGoalProgress(firstTx.goalId);
             }

            await checkBudgetAlertForUser(req.userId!); 

            await logAction(req, { action: "Created Recurring Transaction", statusCode: 201, description: `Tạo giao dịch định kỳ ngày ${recurringDay}` });

            res.status(201).json({ message: "Đã tạo giao dịch định kỳ và bản đầu tiên", template: templateTx, transaction: firstTx });
            return;
        }

        if (!date) {
            res.status(400).json({ message: "Giao dịch thường cần trường `date`" });
            return;
        }

        const tx = await Transaction.create({
            user: req.userId,
            amount,
            type,
            category,
            note,
            receiptImage: receiptImages,
            isRecurring: false,
            date,
            currency: finalCurrency,
            exchangeRate,
            goalId: goalId || null,
        });

        if (tx.goalId) {
            await recalculateGoalProgress(tx.goalId);
        }

        await checkBudgetAlertForUser(req.userId!);

        await logAction(req, { action: "Created Transaction", statusCode: 201, description: `Tạo giao dịch thường ${type} - ${category}` });

        res.status(201).json({ message: "Đã tạo giao dịch thành công", transaction: tx });

    } catch (error) {
        console.error("❌ Lỗi khi tạo giao dịch:", error);
        await logAction(req, { action: "Create Transaction", statusCode: 500, description: "Lỗi khi tạo giao dịch", level: "error" });
        res.status(500).json({ message: "Không thể tạo giao dịch", error });
    }
};

// GET ALL
export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      type, 
      category, 
      keyword, 
      startDate, 
      endDate 
    } = req.query;

    const filter: any = { user: req.userId };

    if (type) filter.type = type;
    if (category) filter.category = category;
    if (keyword) filter.note = { $regex: keyword, $options: "i" };

    let start: Date;
    let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    filter.date = { $gte: start, $lte: end };

    const skip = (Number(page) - 1) * Number(limit);

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    const summary = await Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const totalIncome =
      summary.find((s) => s._id === "income")?.totalAmount || 0;
    const totalExpense =
      summary.find((s) => s._id === "expense")?.totalAmount || 0;

    res.json({
      data: transactions,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      summary: {
        income: totalIncome,
        expense: totalExpense,
        balance: totalIncome - totalExpense,
      },
      timeRange: {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
      },
    });
  } catch (err) {
    console.error("❌ getTransactions error:", err);
    res.status(500).json({ message: "Không thể lấy danh sách giao dịch!", error: err });
  }
};

export const getTransactionsByMonth = async (req: AuthRequest, res: Response) => {
  try {
    const { month, year } = req.query;

    const monthNum = Number(month);
    const yearNum = Number(year);

    if (!month || !year || isNaN(monthNum) || isNaN(yearNum)) {
      res.status(400).json({ message: 'Thiếu hoặc sai định dạng month/year' });
      return;
    }

    const startOfMonth = new Date(yearNum, monthNum - 1, 1);
    const endOfMonth = new Date(yearNum, monthNum, 1); 

    const filter = {
      user: req.userId,
      date: { $gte: startOfMonth, $lt: endOfMonth },
    };

    const transactions = await Transaction.find(filter).sort({ date: 1 }); 

    res.json({
      data: transactions,
      total: transactions.length,
      page: 1,
      totalPage: 1,
    });

  } catch (err) {
    console.error('[getTransactionsByMonth]', err);
    res.status(500).json({ message: 'Không thể lấy danh sách giao dịch!', error: err });
  }
}

// UPDATE
export const updateTransaction = async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      console.log("📂 Files received:", req.files); 
      console.log("📝 Body received:", req.body);
      
        const { id } = req.params;
        const userId = req.userId;

        const updates = req.body;

        const oldTx = await Transaction.findOne({ _id: id, user: userId });
        if (!oldTx) {
            return res.status(404).json({ message: "Giao dịch không tồn tại!" });
        }

        const dataToProcess = {
            amount: updates.amount !== undefined ? updates.amount : oldTx.amount,
            currency: updates.currency || oldTx.currency,
            date: updates.date || oldTx.date,
            type: updates.type || oldTx.type,
            category: updates.category || oldTx.category,
            note: updates.note !== undefined ? updates.note : oldTx.note,
            isRecurring: updates.isRecurring !== undefined ? updates.isRecurring : oldTx.isRecurring,
            recurringDay: updates.recurringDay || oldTx.recurringDay,
            goalId: updates.goalId !== undefined ? updates.goalId : oldTx.goalId 
        };

        const processedData = await processTransactionData(dataToProcess);

        let finalImages = oldTx.receiptImage;

        if (updates.existingImages !== undefined || (req.files && Array.isArray(req.files) && req.files.length > 0)) {
            
            let keepImages: string[] = [];
            if (updates.existingImages) {
                keepImages = Array.isArray(updates.existingImages) ? updates.existingImages : [updates.existingImages];
            }

            let newUploadedImages: string[] = [];
            if (req.files && Array.isArray(req.files)) {
                const uploadPromises = (req.files as Express.Multer.File[]).map(file => {
                    const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
                    return cloudinary.uploader.upload(base64, {
                        folder: 'fintrack_receipts',
                        public_id: `receipt-${uuid()}`,
                    });
                });
                const results = await Promise.all(uploadPromises);
                newUploadedImages = results.map(result => result.secure_url);
            }

            finalImages = [...keepImages, ...newUploadedImages];
        }

        const isRecurringBool = String(processedData.isRecurring) === "true";
        if (isRecurringBool && (!processedData.recurringDay || processedData.recurringDay < 1 || processedData.recurringDay > 31)) {
             return res.status(400).json({ message: "Ngày định kỳ không hợp lệ" });
        }

        const updateFields = {
            ...processedData, 
            receiptImage: finalImages,
            date: processedData.date ? new Date(processedData.date) : undefined,
            isRecurring: isRecurringBool,
            recurringDay: isRecurringBool ? processedData.recurringDay : undefined,
        };

        const updatedTx = await Transaction.findOneAndUpdate(
            { _id: id, user: userId },
            { $set: updateFields }, 
            { new: true }
        );

        if (!updatedTx) return res.status(404).json({ message: "Lỗi cập nhật (không tìm thấy sau khi query)" });

        const isFinancialChange = 
            oldTx.amount !== updatedTx.amount || 
            oldTx.currency !== updatedTx.currency ||
            oldTx.goalId?.toString() !== updatedTx.goalId?.toString();

        if (isFinancialChange) {
            console.log(`🔄 Phát hiện thay đổi tài chính giao dịch ${id}, đang tính toán lại Goal/Budget...`);

            const goalIdsToUpdate = new Set<string>();
            if (oldTx.goalId) goalIdsToUpdate.add(oldTx.goalId.toString());
            if (updatedTx.goalId) goalIdsToUpdate.add(updatedTx.goalId.toString());

            if (goalIdsToUpdate.size > 0) {
                await Promise.all(
                    Array.from(goalIdsToUpdate).map(gId => recalculateGoalProgress(gId))
                );
            }

            await checkBudgetAlertForUser(userId!); 
        } else {
            console.log(`ℹ️ Giao dịch ${id} chỉ cập nhật thông tin phụ (Note/Image), bỏ qua tính toán lại.`);
        }

        await logAction(req, { 
            action: "Update Transaction", 
            statusCode: 200, 
            description: `Đã cập nhật giao dịch ID: ${id}`, 
        });

        res.json(updatedTx);

    } catch (error) {
        console.error("❌ Lỗi khi cập nhật giao dịch:", error);
        await logAction(req, { action: "Update Transaction", statusCode: 500, description: "Lỗi khi cập nhật giao dịch", level: "error" });
        res.status(500).json({ message: "Không thể cập nhật!", error });
    }
};

// DELETE
export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const tx = await Transaction.findOne({ _id: id, user: userId });

    if (!tx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    const goalId = tx.goalId; 

    await Transaction.deleteOne({ _id: id });

    if (goalId) {
      await recalculateGoalProgress(goalId);
    }

    await checkBudgetAlertForUser(userId!);

    await logAction(req, {
      action: "Delete Transaction",
      statusCode: 200,
      description: `Đã xoá giao dịch ID: ${id}`
    });

    res.json({ message: "Đã xóa giao dịch và cập nhật mục tiêu!" });

  } catch (error) {
    console.log(error);

    await logAction(req, {
      action: "Delete Transaction",
      statusCode: 500,
      description: "Lỗi khi xoá giao dịch",
      level: "error"
    });

    res.status(500).json({ message: "Không thể xóa giao dịch!", error });
  }
};

// GET ALL ACTIVE RECURRING TRANSACTIONS
export const getActiveRecurringTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { includeGenerated = "false" } = req.query;

    const filter: any = {
      user: req.userId,
      isRecurring: true,
    };

    if (includeGenerated === "false") {
      filter.$or = [{ date: null }, { date: { $exists: false } }];
    }

    const recurringTxs = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const grouped = recurringTxs.reduce((acc: Record<string, any[]>, tx) => {
      const key = tx.recurringId || tx._id.toString();
      if (!acc[key]) acc[key] = [];
      acc[key].push(tx);
      return acc;
    }, {});

    res.json({
      message: "Danh sách giao dịch định kỳ đang hoạt động",
      totalGroups: Object.keys(grouped).length,
      data: grouped,
    });
  } catch (error) {
    console.error("❌ Lỗi khi lấy recurring transactions:", error);

    await logAction(req, {
      action: "Get Recurring Transactions",
      statusCode: 500,
      description: "Lỗi khi lấy recurring transactions",
      level: "error",
    });

    res.status(500).json({ message: "Không thể lấy danh sách recurring!", error });
  }
};

// CANCEL RECURRING
export const cancelRecurringTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { deleteAll } = req.query; 

    const tx = await Transaction.findOne({ _id: id, user: req.userId });
    if (!tx) {
      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    if (!tx.isRecurring || !tx.recurringId) {
      res.status(400).json({ message: "Đây không phải là giao dịch định kỳ!" });
      return;
    }

    if (deleteAll === "true") {
      const relatedGoalIds = await Transaction.distinct("goalId", {
        user: req.userId,
        recurringId: tx.recurringId,
        goalId: { $ne: null }
      });

      const deleted = await Transaction.deleteMany({
        user: req.userId,
        recurringId: tx.recurringId,
      });

      if (relatedGoalIds.length > 0) {
          for (const gId of relatedGoalIds) {
            await recalculateGoalProgress(gId);
          }
      }

      await logAction(req, {
        action: "Delete All Recurring",
        statusCode: 200,
        description: `Đã xóa ${deleted.deletedCount} giao dịch thuộc chuỗi ${tx.recurringId}`,
      });

      res.json({
        message: `Đã xóa toàn bộ chuỗi giao dịch (${deleted.deletedCount} mục) và cập nhật lại Goal.`,
      });
      return;
    }

    await Transaction.deleteOne({
        user: req.userId,
        recurringId: tx.recurringId,
        date: { $exists: false } 
    });

    await Transaction.updateMany(
      { 
        user: req.userId, 
        recurringId: tx.recurringId,
        date: { $exists: true } 
      },
      { 
        $set: { 
            isRecurring: false, 
            note: `(Đã dừng định kỳ) ${tx.note || ""}` 
        },
        $unset: { recurringId: 1 } 
      }
    );

    await logAction(req, {
      action: "Stop Recurring",
      statusCode: 200,
      description: `Đã dừng chuỗi định kỳ ID: ${tx.recurringId}`,
    });

    res.json({
      id,
      message: "Đã dừng giao dịch định kỳ. Các giao dịch quá khứ đã chuyển thành giao dịch thường.",
    });

  } catch (error) {
    console.error("Lỗi hủy recurring:", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};

export const getUsedCategories = async (req: AuthRequest, res: Response) => {
    try {
        const categories = await Transaction.distinct("category", { user: req.userId });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: "Không thể lấy danh mục!", error});
    }   
}

export const triggerRecurringTest = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();

    const recurringTransactions = await Transaction.find({
      isRecurring: true,
      recurringDay: { $gte: 1, $lte: 31 },
    });

    let results = [];

    for (const tx of recurringTransactions) {
      const triggerDay = Math.min(tx.recurringDay as number, getLastDayOfMonth(year, month));

      if (triggerDay !== today) continue;

      const exists = await Transaction.findOne({
        user: tx.user,
        type: tx.type,
        category: tx.category,
        isRecurring: true,
        recurringDay: tx.recurringDay,
        date: {
          $gte: new Date(year, month, 1),
          $lt: new Date(year, month + 1, 1),
        },
      });

      if (exists) {
        results.push({
          note: tx.note,
          status: "skipped",
          reason: "already exists this month",
        });
        continue;
      }

      const newTx = await Transaction.create({
        user: tx.user,
        amount: tx.amount,
        type: tx.type,
        category: tx.category,
        note: tx.note,
        date: new Date(year, month, triggerDay),
        isRecurring: true,
        recurringDay: tx.recurringDay,
        receiptImage: tx.receiptImage || [],
      });

      results.push({
        note: tx.note,
        status: "created",
        newTxId: newTx._id,
      });
    }

    res.status(200).json({
      message: "Recurring job triggered manually",
      today,
      created: results.filter((r) => r.status === "created").length,
      total: results.length,
      details: results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error running recurring test", error });
  }
};

export const getTopTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const {
      limit = 10,
      type,
      startDate,
      endDate,
      order = "desc",
    } = req.query;

    let start: Date;
    let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const matchFilter: any = {
      user: new mongoose.Types.ObjectId(req.userId), 
      date: { $gte: start, $lte: end },
    };
    if (type) matchFilter.type = type;

    const countFilter: any = {
      user: req.userId,
      date: { $gte: start, $lte: end },
    };
    if (type) countFilter.type = type;

    const sortOrder = order === "desc" ? -1 : 1;
    const numLimit = Number(limit);

    const [transactions, total] = await Promise.all([
      Transaction.aggregate([
        {
          $match: matchFilter, 
        },
        {
          $addFields: {
            baseAmount: {
              $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }], //
            },
          },
        },
        {
          $sort: { baseAmount: sortOrder },
        },
        {
          $limit: numLimit,
        },
      ]),
      Transaction.countDocuments(countFilter),
    ]);

    res.json({
      data: transactions,
      total: total,
      limit: numLimit,
      page: 1,
      timeRange: {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
      },
    });
  } catch (err) {
    console.error("❌ getTransactions error:", err);
    res.status(500).json({
      message: "Không thể lấy danh sách giao dịch!",
      error: err,
    });
  }
};

export const deleteLastTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const userId = user._id; 

    const lastTx = await Transaction.findOne({ user: userId })
      .sort({ createdAt: -1 })
      .populate("category", "name");

    if (!lastTx) {
      res.status(404).json({ 
        success: false, 
        message: "Không tìm thấy giao dịch nào để xóa." 
      });
      return;
    }

    const savedGoalId = lastTx.goalId;

    await Transaction.deleteOne({ _id: lastTx._id });

    if (savedGoalId) {
      await recalculateGoalProgress(savedGoalId);
    }

    res.status(200).json({
      success: true,
      data: lastTx, 
    });

  } catch (error) {
    console.error("Error deleting last transaction:", error);
    res.status(500).json({ 
      success: false, 
      message: "Lỗi server khi xóa giao dịch." 
    });
    return;
  }
};

export const cancelRecurringByKeyword = async (req: AuthRequest, res: Response) => {
  try {
    const { keyword } = req.query; 

    if (!keyword) {
      res.status(400).json({ message: "Vui lòng cung cấp từ khóa tên gói (ví dụ: Netflix)" });
      return;
    }

    const template = await Transaction.findOne({
      user: req.userId,
      isRecurring: true,
      date: null,
      note: { $regex: keyword, $options: 'i' } 
    });

    if (!template) {
      res.status(404).json({ 
        message: `Không tìm thấy gói định kỳ nào khớp với từ khóa "${keyword}".` 
      });
      return;
    }

    await Transaction.deleteOne({ _id: template._id });

    await Transaction.updateMany(
      {
        user: req.userId,
        recurringId: template.recurringId,
        date: { $ne: null } 
      },
      {
        $set: {
          isRecurring: false,
          note: `${template.note} (Đã dừng gia hạn)` 
        },
        $unset: { recurringId: 1 } 
      }
    );

    await logAction(req, {
      action: "Chatbot Cancel Recurring",
      statusCode: 200,
      description: `Chatbot đã dừng gói định kỳ: ${template.note}`,
    });

    res.json({
      success: true,
      data: template, 
      message: "Đã dừng gói định kỳ thành công."
    });

  } catch (error) {
    console.error("Lỗi Chatbot hủy recurring:", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};