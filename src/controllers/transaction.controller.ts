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

const updateGoalProgress = async (transaction: ITransaction) => {
    try {
        // Chỉ chạy nếu giao dịch này có liên kết với một mục tiêu
        if (transaction.goalId && transaction.type === 'expense') {
            // Tính toán giá trị cơ sở (VND) của khoản đóng góp này
            // (Giả định exchangeRate đã là tỷ giá quy đổi về VND)
            const baseAmountToAdd = transaction.amount * transaction.exchangeRate;

            if (baseAmountToAdd === 0) return;

            // Tăng (hoặc giảm nếu là số âm) `currentBaseAmount` của Mục tiêu
            await Goal.findByIdAndUpdate(transaction.goalId, {
                $inc: { currentBaseAmount: baseAmountToAdd },
            });
            
            console.log(`[Goal Update] Cập nhật Goal ${transaction.goalId} thêm ${baseAmountToAdd} VND`);
        }
    } catch (error) {
        console.error(`[Goal Update Error] Lỗi khi cập nhật mục tiêu ${transaction.goalId}:`, error);
        // Tùy chọn: log lỗi này vào hệ thống logging của bạn
        //await logAction(null, { action: "Update Goal Progress", statusCode: 500, ... });
    }
};

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

            // --- 4. GỌI HÀM CẬP NHẬT GOAL ---
            // Chỉ cập nhật cho giao dịch đầu tiên (có thật)
            await updateGoalProgress(firstTx);

            // --- 5. KIỂM TRA CẢNH BÁO NGÂN SÁCH --- // <-- THÊM MỚI
            // Chỉ kiểm tra cho giao dịch đầu tiên (có thật)
            await checkBudgetAlertForUser(req.userId!); 

            await logAction(req, { action: "Create Recurring Transaction", statusCode: 201, description: `Tạo giao dịch định kỳ ngày ${recurringDay}` });

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

        // --- 4. GỌI HÀM CẬP NHẬT GOAL ---
        await updateGoalProgress(tx);

        // --- 5. KIỂM TRA CẢNH BÁO NGÂN SÁCH --- // <-- THÊM MỚI
        await checkBudgetAlertForUser(req.userId!);

        await logAction(req, { action: "Create Transaction", statusCode: 201, description: `Tạo giao dịch thường ${type} - ${category}` });

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

        // 2. HOÀN TÁC ẢNH HƯỞNG CỦA GIAO DỊCH CŨ (Revert Goal)
        // Nếu giao dịch cũ là 'saving' và có goalId -> Trừ tiền đi
        if (oldTx.type === 'expense' && oldTx.category === 'saving' && oldTx.goalId) {
             const oldBaseAmount = oldTx.amount * (oldTx.exchangeRate || 1);
             await Goal.findOneAndUpdate(
                 { _id: oldTx.goalId, user: userId },
                 { $inc: { currentBaseAmount: -oldBaseAmount } }
             );
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

        // Cập nhật mục tiêu (NÊN CÓ)
        await updateGoalProgress(updatedTx); 

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

    // 1. Tìm giao dịch trước (KHÔNG xóa ngay)
    const tx = await Transaction.findOne({ _id: id, user: userId });

    if (!tx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    // 2. Kiểm tra và Cập nhật Goal (Nếu giao dịch này liên kết với Goal)
    if (tx.category === 'saving' && tx.goalId) {
        // Tính số tiền gốc (VND) cần trừ
        const amountBaseToRemove = tx.amount * (tx.exchangeRate || 1);

        console.log(`🔄 Đang hoàn lại ${amountBaseToRemove} cho Goal ${tx.goalId}`);

        await Goal.findOneAndUpdate(
            { _id: tx.goalId, userId: userId },
            { 
                // Dùng $inc với số âm để trừ đi
                $inc: { currentBaseAmount: -amountBaseToRemove } 
            }
        );
    }

    // 3. Bây giờ mới xóa giao dịch
    await Transaction.deleteOne({ _id: id });

    // 4. 🔥 CẬP NHẬT TRẠNG THÁI NGÂN SÁCH (THÊM MỚI)
    // Để hệ thống reset alertLevel từ 100% về 0% (ví dụ)
    await checkBudgetAlertForUser(userId!);

    // 4. Ghi log & Phản hồi
    await logAction(req, {
      action: "Delete Transaction",
      statusCode: 200,
      description: `Đã xoá giao dịch ID: ${id} (Goal update: ${!!tx.goalId})`
    });

    // (Tùy chọn) Gọi lại hàm check budget nếu cần, 
    // nhưng thường xóa giao dịch saving sẽ không ảnh hưởng xấu đến budget cảnh báo.
    
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
    const { deleteAll = false} = req.query; // query param để quyết định có xóa hết hay không

    // 1️⃣ Tìm giao dịch định kỳ theo ID
    const tx = await Transaction.findOne({_id: id, user: req.userId });
    if(!tx){
      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    // 2️⃣ Kiểm tra có phải giao dịch định kỳ không
    if(!tx.isRecurring || !tx.recurringId){
      res.status(400).json({message: "Giao dịch này không phải định kỳ!"});
      return;
    }

    // 3️⃣ Nếu deleteAll = true -> xóa tất cả cùng recurringId
    if (deleteAll === "true") {
      const deleted = await Transaction.deleteMany({
        user: req.userId,
        recurringId: tx.recurringId,
      });

      await logAction(req, {
        action: "Cancel Recurring Transactions (All)",
        statusCode: 200,
        description: `Hủy toàn bộ ${deleted.deletedCount} giao dịch recurring ID: ${tx.recurringId}`,
      });

      res.json({
        message: `Đã hủy toàn bộ chuỗi giao dịch định kỳ (${deleted.deletedCount} mục)!`,
        recurringId: tx.recurringId,
      });
      return;
    }

    // 4️⃣ Chỉ hủy bản template (và ngắt recurring)
    await Transaction.updateMany(
      { user: req.userId, recurringId: tx.recurringId },
      { $set: { isRecurring: false, recurringId: undefined } }
    );

    await logAction(req, {
      action: "Cancel Recurring Template",
      statusCode: 200,
      description: `Hủy recurring template ID: ${tx._id}`,
    });

    res.json({
      message: "Đã hủy recurring — các giao dịch trước đó vẫn giữ nguyên.",
      recurringId: tx.recurringId,
    });
  } catch (error) {
    
  }
}

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