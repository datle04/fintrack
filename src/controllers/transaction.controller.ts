import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import Transaction from '../models/Transaction';
import cloudinary from '../utils/cloudinary';
import { v4 as uuid } from 'uuid';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';
import { logAction } from '../utils/logAction';
import { checkBudgetAlertForUser } from '../cron/checkBudgetAlertForUser';
import axios from "axios";

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
      isRecurring
    } = req.body;

    if (amount < 0) {
      res.status(400).json({ message: "Số tiền không hợp lệ!" });
      return;
    }

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

      const templateTx = await Transaction.create({
        user: req.userId,
        amount,
        type,
        category,
        note,
        receiptImage: receiptImages,
        isRecurring: true,
        recurringDay,
        recurringId,
        date: undefined
      });

      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      const day = Math.min(+recurringDay, getLastDayOfMonth(year, month));

      const firstTx = await Transaction.create({
        user: req.userId,
        amount,
        type,
        category,
        note,
        receiptImage: receiptImages,
        isRecurring: true,
        recurringDay,
        recurringId,
        date: new Date(date)
      });

      await logAction(req, {
        action: "Create Recurring Transaction",
        statusCode: 201,
        description: `Tạo giao dịch định kỳ ngày ${recurringDay}`
      });

      res.status(201).json({
        message: "Đã tạo giao dịch định kỳ và bản đầu tiên",
        template: templateTx,
        firstTransaction: firstTx
      });
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
      date
    });

    if (tx.type === 'expense') {
  const userId = typeof tx.user === 'object' ? tx.user.toString() : tx.user;
  console.log('🚀 Gọi checkBudgetAlertForUser với userId:', userId);
  await checkBudgetAlertForUser(userId);
}

    await logAction(req, {
      action: "Create Transaction",
      statusCode: 201,
      description: `Tạo giao dịch thường ${type} - ${category}`
    });

    res.status(201).json({
      message: "Đã tạo giao dịch thành công",
      transaction: tx
    });

  } catch (error) {
    console.error("❌ Lỗi khi tạo giao dịch:", error);

    await logAction(req, {
      action: "Create Transaction",
      statusCode: 500,
      description: "Lỗi khi tạo giao dịch",
      level: "error"
    });

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
    const {
      amount,
      type,
      category,
      note,
      date,
      isRecurring,
      recurringDay,
      existingImages, 
    } = req.body;

    let keepImages: string[] = [];
    if (existingImages) {
      keepImages = Array.isArray(existingImages) ? existingImages : [existingImages];
    }

    let newUploadedImages: string[] = [];

    // Nếu có file mới được upload
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

    const isRecurringBool = isRecurring === "true" || isRecurring === true;

    if (isRecurringBool && (recurringDay < 1 || recurringDay > 31)) {
      return res.status(400).json({ message: "Ngày định kỳ không hợp lệ" });
    }

    const finalImages = [...keepImages, ...newUploadedImages];

    const updatedTx = await Transaction.findOneAndUpdate(
      { _id: id, user: req.userId },
      {
        amount,
        type,
        category,
        note,
        date: date ? new Date(date) : undefined,
        isRecurring: isRecurringBool,
        recurringDay: isRecurringBool ? recurringDay : undefined,
        receiptImage: finalImages, // luôn cập nhật ảnh: gộp ảnh cũ + mới
      },
      { new: true }
    );

    if (!updatedTx) {
      return res.status(404).json({ message: "Giao dịch không tồn tại!" });
    }

    await logAction(req, {
      action: "Update Transaction",
      statusCode: 200,
      description: `Đã cập nhật giao dịch ID: ${id}`,
    });

    res.json(updatedTx);
  } catch (error) {
    console.error("❌ Lỗi khi cập nhật giao dịch:", error);

    await logAction(req, {
      action: "Update Transaction",
      statusCode: 500,
      description: "Lỗi khi cập nhật giao dịch",
      level: "error",
    });

    res.status(500).json({ message: "Không thể cập nhật!", error });
  }
};

// DELETE
export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tx = await Transaction.findOneAndDelete({ _id: id, user: req.userId });

    if (!tx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    await logAction(req, {
      action: "Delete Transaction",
      statusCode: 200,
      description: `Đã xoá giao dịch ID: ${id}`
    });

    res.json({ message: "Đã xóa giao dịch!" });
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
    // 📦 Lấy các tham số từ query
    const { 
      limit = 10, 
      type, 
      startDate, 
      endDate,
      order = 'desc'
    } = req.query;

    // 🧭 Xây dựng bộ lọc cơ bản
    const filter: any = { user: req.userId };

    if (type) filter.type = type;

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

    // 🧮 Thực hiện song song 2 truy vấn
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ amount: order === 'desc' ? -1 : 1 })
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    // 📦 Trả kết quả
    res.json({
      data: transactions,
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