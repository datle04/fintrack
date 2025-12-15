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
        // Lấy tỷ giá hối đoái (fromCurrency -> VND)
        exchangeRate = await getExchangeRate(transactionCurrency);
    }
    
    // Tạo đối tượng dữ liệu giao dịch mới (chỉ dùng cho logic lưu)
    // Lưu ý: amount vẫn là giá trị gốc, tỷ giá được lưu riêng.
    return {
        ...data,
        currency: transactionCurrency,
        exchangeRate: exchangeRate,
    };
}


// CREATE
export const createTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const {
            amount,
            type,
            category,
            note,
            date,
            recurringDay,
            isRecurring,
            currency, // <-- Lấy trường mới từ body
            goalId,
        } = req.body;

        if (amount < 0) {
            res.status(400).json({ message: "Số tiền không hợp lệ!" });
            return;
        }

        // 1. XỬ LÝ ĐA TIỀN TỆ: Lấy tỷ giá và currency cuối cùng
        const { exchangeRate, currency: finalCurrency } = await processTransactionData({ currency, amount });
        
        // 2. IMAGE UPLOAD
        let receiptImages: string[] = [];
        if (req.files && Array.isArray(req.files)) {
            const uploadPromises = (req.files as Express.Multer.File[]).map(file => {
                const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
                // Assuming cloudinary.uploader.upload and uuid() are imported
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
            // 3. TẠO GIAO DỊCH ĐỊNH KỲ (UPDATED)
            if (!recurringDay || recurringDay < 1 || recurringDay > 31) {
                res.status(400).json({ message: "Ngày định kỳ (recurringDay) không hợp lệ" });
                return;
            }

            const recurringId = uuid();

            // Các trường chung cho Template và First Transaction
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
                // <-- THÊM THÔNG TIN TIỀN TỆ
                currency: finalCurrency,
                exchangeRate,
                goalId: goalId || null
            };

            // a. Template Transaction (date: undefined)
            const templateTx = await Transaction.create({ ...commonFields, date: undefined });

            // b. First Transaction (sử dụng date truyền vào)
            const firstTx = await Transaction.create({ 
                ...commonFields, 
                date: new Date(date) 
            });

            // 🔥 SỬA ĐOẠN NÀY: Thay updateGoalProgress bằng recalculateGoalProgress
             // Chỉ cập nhật cho giao dịch đầu tiên (firstTx) vì nó có ngày thực tế
             if (firstTx.goalId) {
                await recalculateGoalProgress(firstTx.goalId);
             }

            // --- 5. KIỂM TRA CẢNH BÁO NGÂN SÁCH --- // <-- THÊM MỚI
            // Chỉ kiểm tra cho giao dịch đầu tiên (có thật)
            await checkBudgetAlertForUser(req.userId!); 

            await logAction(req, { action: "Created Recurring Transaction", statusCode: 201, description: `Tạo giao dịch định kỳ ngày ${recurringDay}` });

            res.status(201).json({ message: "Đã tạo giao dịch định kỳ và bản đầu tiên", template: templateTx, firstTransaction: firstTx });
            return;
        }

        // 4. TẠO GIAO DỊCH THÔNG THƯỜNG (UPDATED)
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
            // <-- THÊM THÔNG TIN TIỀN TỆ
            currency: finalCurrency,
            exchangeRate,
            goalId: goalId || null,
        });

       // 🔥 SỬA ĐOẠN NÀY: Dùng tính toán lại toàn bộ
        if (tx.goalId) {
            await recalculateGoalProgress(tx.goalId);
        }

        // --- 5. KIỂM TRA CẢNH BÁO NGÂN SÁCH --- // <-- THÊM MỚI
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
    // 📦 Lấy các tham số từ query
    const { 
      page = 1, 
      limit = 10, 
      type, 
      category, 
      keyword, 
      startDate, 
      endDate 
    } = req.query;

    // 🧭 Xây dựng bộ lọc cơ bản
    const filter: any = { user: req.userId };

    if (type) filter.type = type;
    if (category) filter.category = category;
    if (keyword) filter.note = { $regex: keyword, $options: "i" };

    // 🗓️ Lọc theo khoảng thời gian
    // Nếu không truyền thì mặc định lấy tháng hiện tại
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

    // 📜 Phân trang
    const skip = (Number(page) - 1) * Number(limit);

    // 🧮 Thực hiện song song 2 truy vấn
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    // 📊 Tổng thu & chi trong khoảng thời gian
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

    // 📦 Trả kết quả
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

    // Ép kiểu an toàn hơn
    const monthNum = Number(month);
    const yearNum = Number(year);

    // Bắt buộc phải có cả tháng và năm để lọc cho chính xác
    if (!month || !year || isNaN(monthNum) || isNaN(yearNum)) {
      res.status(400).json({ message: 'Thiếu hoặc sai định dạng month/year' });
      return;
    }

    const startOfMonth = new Date(yearNum, monthNum - 1, 1);
    const endOfMonth = new Date(yearNum, monthNum, 1); // đầu tháng sau

    const filter = {
      user: req.userId,
      date: { $gte: startOfMonth, $lt: endOfMonth },
    };

    const transactions = await Transaction.find(filter).sort({ date: 1 }); // sort tăng dần để thống kê đẹp hơn

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
        const { id } = req.params;
        const userId = req.userId
        const {
            amount,
            type,
            category,
            note,
            date,
            isRecurring,
            recurringDay,
            existingImages,
            currency, // <-- Lấy trường mới từ body
            goalId,
        } = req.body;

        // 1. Tìm giao dịch CŨ trước khi update (QUAN TRỌNG)
        const oldTx = await Transaction.findOne({ _id: id, user: userId });
        if (!oldTx) {
            return res.status(404).json({ message: "Giao dịch không tồn tại!" });
        }

        // 1. XỬ LÝ ĐA TIỀN TỆ: Lấy tỷ giá và currency cuối cùng
        const processedData = await processTransactionData({ 
            currency, 
            amount,
            type, // Các trường khác cần truyền qua helper để tránh mất
            category, 
            note,
            date, 
            isRecurring,
            recurringDay,
            goalId: goalId || null
        });
        
        // 2. IMAGE HANDLING (Logic cũ)
        let keepImages: string[] = [];
        if (existingImages) {
            keepImages = Array.isArray(existingImages) ? existingImages : [existingImages];
        }

        let newUploadedImages: string[] = [];
        if (req.files && Array.isArray(req.files)) {
             // ... (logic upload ảnh cũ)
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

        const isRecurringBool = isRecurring === "true" || isRecurring === true;

        if (isRecurringBool && (recurringDay < 1 || recurringDay > 31)) {
            return res.status(400).json({ message: "Ngày định kỳ không hợp lệ" });
        }

        const finalImages = [...keepImages, ...newUploadedImages];

        // 3. DATABASE UPDATE (UPDATED)
        const updateFields = {
            amount: processedData.amount,
            type: processedData.type,
            category: processedData.category,
            note: processedData.note,
            date: processedData.date ? new Date(processedData.date) : undefined,
            isRecurring: isRecurringBool,
            recurringDay: isRecurringBool ? processedData.recurringDay : undefined,
            receiptImage: finalImages,
            // <-- CẬP NHẬT THÔNG TIN TIỀN TỆ
            currency: processedData.currency,
            exchangeRate: processedData.exchangeRate,
            goalId: processedData.goalId || null
        };

        const updatedTx = await Transaction.findOneAndUpdate(
            { _id: id, user: userId },
            updateFields,
            { new: true }
        );

        if (!updatedTx) {
            return res.status(404).json({ message: "Giao dịch không tồn tại!" });
        }

        // Tính toán lại Goal (recalculation)
        const goalIdsToUpdate = new Set<string>();

        if (oldTx.goalId) goalIdsToUpdate.add(oldTx.goalId.toString());
        if (updatedTx.goalId) goalIdsToUpdate.add(updatedTx.goalId.toString());

       // Chạy song song (Parallel) để nhanh hơn nếu có 2 Goal cần update
        await Promise.all(
            Array.from(goalIdsToUpdate).map(async (gId) => {
              await recalculateGoalProgress(gId);
            })
        );

        // KIỂM TRA NGÂN SÁCH (sau khi giao dịch đã được cập nhật)
        await checkBudgetAlertForUser(userId!); // 

        await logAction(req, { action: "Update Transaction", statusCode: 200, description: `Đã cập nhật giao dịch ID: ${id}`, });

        res.json(updatedTx);
    } catch (error) {
        console.error("❌ Lỗi khi cập nhật giao dịch:", error);

        await logAction(req, { action: "Update Transaction", statusCode: 500, description: "Lỗi khi cập nhật giao dịch", level: "error", });

        res.status(500).json({ message: "Không thể cập nhật!", error });
    }
};

// DELETE
export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // 1. Tìm giao dịch trước để lấy goalId (quan trọng)
    const tx = await Transaction.findOne({ _id: id, user: userId });

    if (!tx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    const goalId = tx.goalId; // Lưu lại ID mục tiêu

    // 3. Xóa giao dịch
    await Transaction.deleteOne({ _id: id });

    // 4. 🔥 TÍNH TOÁN LẠI GOAL (FULL RECALCULATION)
    // Vì giao dịch đã bị xóa khỏi DB, hàm này sẽ tính tổng các giao dịch CÒN LẠI
    // => Kết quả tự động giảm đi đúng bằng số tiền vừa xóa.
    if (goalId) {
      await recalculateGoalProgress(goalId);
    }

    // 5. Cập nhật trạng thái ngân sách
    await checkBudgetAlertForUser(userId!);

    // 6. Log & Response
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

    // 1️⃣ Lọc tất cả recurring còn hoạt động (có recurringId hoặc isRecurring)
    const filter: any = {
      user: req.userId,
      isRecurring: true,
    };

    // 2️⃣ Nếu không muốn lấy các bản generated, chỉ lấy template (date: null hoặc undefined)
    if (includeGenerated === "false") {
      filter.$or = [{ date: null }, { date: { $exists: false } }];
    }

    const recurringTxs = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // 3️⃣ Gom nhóm theo recurringId (để dễ hiển thị ở frontend)
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
    const { deleteAll } = req.query; // deleteAll = "true" hoặc "false"

    // 1. Tìm giao dịch hiện tại để lấy recurringId
    const tx = await Transaction.findOne({ _id: id, user: req.userId });
    if (!tx) {
      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    if (!tx.isRecurring || !tx.recurringId) {
      res.status(400).json({ message: "Đây không phải là giao dịch định kỳ!" });
      return;
    }

    // =========================================================
    // TRƯỜNG HỢP 1: XÓA TẤT CẢ (QUÁ KHỨ + TƯƠNG LAI + TEMPLATE)
    // =========================================================
    if (deleteAll === "true") {
      // a. Tìm tất cả các Goal ID bị ảnh hưởng trước khi xóa
      // (Dùng distinct để lấy danh sách Goal ID duy nhất liên quan đến chuỗi này)
      const relatedGoalIds = await Transaction.distinct("goalId", {
        user: req.userId,
        recurringId: tx.recurringId,
        goalId: { $ne: null } // Chỉ lấy cái nào có goalId
      });

      // b. Xóa tất cả giao dịch
      const deleted = await Transaction.deleteMany({
        user: req.userId,
        recurringId: tx.recurringId,
      });

      // c. 🔥 TÍNH TOÁN LẠI GOAL (Recalculate)
      // Chạy vòng lặp update lại tiến độ cho các Goal bị ảnh hưởng
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

    // =========================================================
    // TRƯỜNG HỢP 2: CHỈ DỪNG ĐỊNH KỲ (NGẮT TƯƠNG LAI)
    // =========================================================
    
    // a. Xóa bản ghi TEMPLATE (Bản ghi dùng để clone, thường không có date hoặc date ảo)
    // Bản template là bản có recurringId khớp VÀ (không có date HOẶC là bản ghi gốc ban đầu)
    // Để an toàn, ta xóa bản ghi nào có recurringId khớp mà date = null/undefined (nếu logic tạo của bạn là thế)
    // Hoặc đơn giản hơn: Ta update các bản đã diễn ra thành "thường", và xóa bản template.

    // Logic xử lý sạch sẽ nhất:
    // Bước 1: Xóa bản Template (để Cronjob không tìm thấy nữa -> Dừng tương lai)
    await Transaction.deleteOne({
        user: req.userId,
        recurringId: tx.recurringId,
        date: { $exists: false } // Giả sử template không có trường date
    });

    // Bước 2: Update các giao dịch QUÁ KHỨ (đã xảy ra)
    // Ngắt kết nối recurring để chúng trở thành giao dịch thường độc lập
    await Transaction.updateMany(
      { 
        user: req.userId, 
        recurringId: tx.recurringId,
        date: { $exists: true } // Chỉ update các giao dịch thực tế
      },
      { 
        $set: { 
            isRecurring: false, 
            // recurringId: undefined // Có thể giữ lại recurringId để trace lịch sử nếu muốn, hoặc xóa đi tùy bạn
            note: `(Đã dừng định kỳ) ${tx.note || ""}` // Optional: Đánh dấu note
        },
        $unset: { recurringId: 1 } // Xóa trường recurringId để ngắt hoàn toàn
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
    // 📦 Lấy các tham số từ query (Giữ nguyên)
    const {
      limit = 10,
      type,
      startDate,
      endDate,
      order = "desc",
    } = req.query;

    // 🗓️ Lọc theo khoảng thời gian (Giữ nguyên)
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

    // --- BẮT ĐẦU SỬA LỖI ---

    // 🧭 Xây dựng bộ lọc cho $match (PHẢI DÙNG ObjectId)
    const matchFilter: any = {
      user: new mongoose.Types.ObjectId(req.userId), // <-- 2. ÉP KIỂU SANG OBJECTID
      date: { $gte: start, $lte: end },
    };
    if (type) matchFilter.type = type;

    // 🧭 Xây dựng bộ lọc cho countDocuments (Dùng string, Mongoose tự ép kiểu)
    // (Việc này an toàn hơn là truyền $match filter vào countDocuments)
    const countFilter: any = {
      user: req.userId,
      date: { $gte: start, $lte: end },
    };
    if (type) countFilter.type = type;

    // --- KẾT THÚC SỬA LỖI ---

    // 🧮 Thực hiện song song 2 truy vấn
    const sortOrder = order === "desc" ? -1 : 1;
    const numLimit = Number(limit);

    const [transactions, total] = await Promise.all([
      // 1. Truy vấn Aggregation (Dùng matchFilter)
      Transaction.aggregate([
        {
          $match: matchFilter, // <-- 3. Sử dụng filter đã ép kiểu
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
      // 2. Đếm tổng số document (Dùng countFilter)
      Transaction.countDocuments(countFilter),
    ]);
    // --- KẾT THÚC THAY ĐỔI ---

    // 📦 Trả kết quả (Giữ nguyên)
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
    const userId = user._id; // Lấy ID từ Token được giải mã

    // 1. Tìm giao dịch mới nhất
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

    // 2. Xóa
    await Transaction.deleteOne({ _id: lastTx._id });

    // 3. Tính lại Goal (nếu có)
    if (savedGoalId) {
      await recalculateGoalProgress(savedGoalId);
    }

    // 4. Trả về thông tin giao dịch đã xóa để Chatbot hiển thị
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

// CANCEL RECURRING BY KEYWORD
// src/controllers/transaction.controller.ts

export const cancelRecurringByKeyword = async (req: AuthRequest, res: Response) => {
  try {
    const { keyword } = req.query; // Nhận từ khóa từ Chatbot

    if (!keyword) {
      res.status(400).json({ message: "Vui lòng cung cấp từ khóa tên gói (ví dụ: Netflix)" });
      return;
    }

    // 1. Tìm bản ghi TEMPLATE dựa trên từ khóa
    // (Template là bản ghi có isRecurring=true và date=null - hoặc logic template của bạn)
    const template = await Transaction.findOne({
      user: req.userId,
      isRecurring: true,
      date: null, // Chỉ tìm template gốc
      note: { $regex: keyword, $options: 'i' } // Tìm gần đúng, không phân biệt hoa thường
    });

    if (!template) {
      res.status(404).json({ 
        message: `Không tìm thấy gói định kỳ nào khớp với từ khóa "${keyword}".` 
      });
      return;
    }

    // 2. Xóa bản ghi TEMPLATE (Để Cronjob không chạy nữa)
    await Transaction.deleteOne({ _id: template._id });

    // 3. Cập nhật các giao dịch QUÁ KHỨ (để nó thành giao dịch thường)
    await Transaction.updateMany(
      {
        user: req.userId,
        recurringId: template.recurringId,
        date: { $ne: null } // Chỉ update các bản ghi lịch sử
      },
      {
        $set: {
          isRecurring: false,
          note: `${template.note} (Đã dừng gia hạn)` // Đánh dấu lại cho rõ
        },
        $unset: { recurringId: 1 } // Ngắt kết nối
      }
    );

    // 4. Log lại hành động
    await logAction(req, {
      action: "Chatbot Cancel Recurring",
      statusCode: 200,
      description: `Chatbot đã dừng gói định kỳ: ${template.note}`,
    });

    res.json({
      success: true,
      data: template, // Trả về để chatbot hiển thị tên/số tiền
      message: "Đã dừng gói định kỳ thành công."
    });

  } catch (error) {
    console.error("Lỗi Chatbot hủy recurring:", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};