import Transaction from "../../models/Transaction";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";
import { AuthRequest } from "../../middlewares/requireAuth";
import cloudinary from "../../utils/cloudinary";
import { v4 as uuid } from 'uuid';
import { getExchangeRate } from "../../services/exchangeRate";
import { getEndOfDay, getStartOfDay } from "../../utils/dateHelper";

// Hàm xử lý chung để lấy tỷ giá và chuẩn bị dữ liệu giao dịch
const processTransactionData = async (data: any) => {
    const transactionCurrency = (data.currency || 'VND').toUpperCase();
    let exchangeRate = 1;

    if (transactionCurrency !== 'VND') {
        // Đây là nơi gọi service tỷ giá
        exchangeRate = await getExchangeRate(transactionCurrency); 
        
        // Kiểm tra tỷ giá an toàn
        if (exchangeRate === 1) {
             throw new Error(`API tỷ giá hối đoái đang trả về tỷ giá 1.0 cho ${transactionCurrency}. Vui lòng kiểm tra API Key.`);
        }
    }
    
    return {
        ...data,
        currency: transactionCurrency,
        exchangeRate: exchangeRate,
    };
}

export const getAllTransactions = async (req: AuthRequest, res: Response) => {
  const {userId, type, category, startDate, endDate, keyword, page = 1,limit = 20,} = req.query;

  const query: any = {};

  if (userId) query.userId = userId;
  if (type) query.type = type;
  if (category) query.category = category;
  if (startDate && endDate) {
    query.date = {
      $gte: getStartOfDay(startDate as string), 
      $lte: getEndOfDay(endDate as string), 
    };
  }
  if (keyword) {
    query.note = { $regex: keyword as string, $options: "i" };
  }

  const skip = (+page - 1) * +limit;

  const transactions = await Transaction.find(query)
    .populate("user", "name email")
    .sort({ date: -1 })
    .skip(skip)
    .limit(+limit);

  const total = await Transaction.countDocuments(query);

  res.json({
      data: transactions,
      total,
      page: +page,
      totalPages: Math.ceil(total / +limit),
    });
};

// Admin không cần check req.userId
// Hàm này đã xử lý đa tiền tệ qua 'processTransactionData', giữ nguyên
export const adminUpdateTransaction = async (
  req: AuthRequest,
  res: Response
) => {
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
      currency,
      goalId,
      userId, // Admin có thể chỉ định userId
    } = req.body;

    const processedData = await processTransactionData({
      currency,
      amount,
      type,
      category,
      note,
      date,
      isRecurring,
      recurringDay,
      goalId: goalId || null,
    });

    let keepImages: string[] = [];
    if (existingImages) {
      keepImages = Array.isArray(existingImages)
        ? existingImages
        : [existingImages];
    }

    let newUploadedImages: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      const uploadPromises = (req.files as Express.Multer.File[]).map(
        (file) => {
          const base64 = `data:${
            file.mimetype
          };base64,${file.buffer.toString("base64")}`;
          return cloudinary.uploader.upload(base64, {
            folder: "fintrack_receipts",
            public_id: `receipt-${uuid()}`,
          });
        }
      );
      const results = await Promise.all(uploadPromises);
      newUploadedImages = results.map((result) => result.secure_url);
    }

    const isRecurringBool = isRecurring === "true" || isRecurring === true;
    const finalImages = [...keepImages, ...newUploadedImages];

    const updateFields = {
      amount: processedData.amount,
      type: processedData.type,
      category: processedData.category,
      note: processedData.note,
      date: processedData.date ? new Date(processedData.date) : undefined,
      isRecurring: isRecurringBool,
      recurringDay: isRecurringBool
        ? processedData.recurringDay
        : undefined,
      receiptImage: finalImages,
      currency: processedData.currency,
      exchangeRate: processedData.exchangeRate,
      goalId: processedData.goalId || null,
      user: userId, // Admin cập nhật user
    };

    const updatedTx = await Transaction.findByIdAndUpdate(id, updateFields, {
      new: true,
    });

    if (!updatedTx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 200,
      description: `Admin đã cập nhật giao dịch ID: ${id}`,
    });

    res.json(updatedTx);
  } catch (error) {
    console.error("❌ Lỗi khi admin cập nhật giao dịch:", error);
    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 500,
      description: "Lỗi khi admin cập nhật giao dịch",
      level: "error",
    });
    res.status(500).json({ message: "Không thể cập nhật!", error });
  }
};

// Hàm này không có lỗi, giữ nguyên
export const adminDeleteTransaction = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const deletedTx = await Transaction.findByIdAndDelete(id);

    if (!deletedTx) {
      return res.status(404).json({ message: "Giao dịch không tồn tại!" });
    }

    await logAction(req, {
      action: "Admin Delete Transaction",
      statusCode: 200,
      description: `Admin đã xóa giao dịch ID: ${id}`,
    });

    res.json({ message: "Đã xóa giao dịch thành công" });
  } catch (error) {
    console.error("❌ Lỗi khi admin xóa giao dịch:", error);
    await logAction(req, {
      action: "Admin Delete Transaction",
      statusCode: 500,
      description: "Lỗi khi admin xóa giao dịch",
      level: "error",
    });
    res.status(500).json({ message: "Không thể xóa!", error });
  }
};

export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const result = await Transaction.findByIdAndDelete(req.params.id);

    if (!result) {
      await logAction(req, {
        action: "Xoá giao dịch thất bại",
        statusCode: 404,
        description: `Giao dịch ID ${req.params.id} không tồn tại`,
        level: "warning",
      });

      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    await logAction(req, {
      action: "Xoá giao dịch",
      statusCode: 200,
      description: `Đã xoá giao dịch ID ${req.params.id}`,
      level: "info",
    });

    res.json({ message: "Đã xoá giao dịch" });
  } catch (error) {
    await logAction(req, {
      action: "Xoá giao dịch thất bại",
      statusCode: 500,
      description: `Lỗi server khi xoá giao dịch ID ${req.params.id}`,
      level: "error",
    });

    console.error("❌ Lỗi xoá giao dịch:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const getTransactionStats = async (req: Request, res: Response) => {
  try {
    // --- SỬA LỖI 1: TÍNH TỔNG DỰA TRÊN TỶ GIÁ ---
    const totalIncome = await Transaction.aggregate([
      { $match: { type: "income" } },
      {
        $group: {
          _id: null,
          total: {
            // Phải nhân amount với exchangeRate
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
    ]);

    // --- SỬA LỖI 2: TÍNH TỔNG DỰA TRÊN TỶ GIÁ ---
    const totalExpense = await Transaction.aggregate([
      { $match: { type: "expense" } },
      {
        $group: {
          _id: null,
          total: {
            // Phải nhân amount với exchangeRate
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
    ]);

    const transactionCount = await Transaction.countDocuments();

    res.json({
      totalIncome: totalIncome[0]?.total || 0,
      totalExpense: totalExpense[0]?.total || 0,
      transactionCount,
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy thống kê giao dịch (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};