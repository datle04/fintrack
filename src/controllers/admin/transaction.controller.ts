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
export const adminUpdateTransaction = async (req: AuthRequest, res: Response): Promise<any> => {
  console.log("req.body", req.body);
  console.log("req.files", req.files);

  try {
    const { id } = req.params;
    const { amount, type, category, note, date, isRecurring, recurringDay, existingImages, currency } = req.body; // Lấy cả currency

    // 1. 💡 PROCESS MULTI-CURRENCY DATA
    const processedData = await processTransactionData({ amount, type, category, note, date, isRecurring, recurringDay, currency });

    let keepImages: string[] = [];
    if (existingImages) {
      keepImages = Array.isArray(existingImages) ? existingImages : [existingImages];
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

    const isRecurringBool = processedData.isRecurring === "true" || processedData.isRecurring === true;

    if (isRecurringBool && (processedData.recurringDay < 1 || processedData.recurringDay > 31)) {
      return res.status(400).json({ message: "Ngày định kỳ không hợp lệ" });
    }

    const finalImages = [...keepImages, ...newUploadedImages];

    const updatedTx = await Transaction.findByIdAndUpdate(
      id,
      {
        // 2. APPLY PROCESSED DATA (Đã có currency và exchangeRate)
        amount: processedData.amount,
        type: processedData.type,
        category: processedData.category,
        note: processedData.note,
        date: processedData.date ? new Date(processedData.date) : undefined,
        isRecurring: isRecurringBool,
        recurringDay: isRecurringBool ? processedData.recurringDay : undefined,
        receiptImage: finalImages,
        currency: processedData.currency,
        exchangeRate: processedData.exchangeRate,
      },
      { new: true }
    ).populate("user", "-password");

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
    const stats = await Transaction.aggregate([
      {
        $group: {
          _id: { $substr: ["$date", 0, 7] }, // YYYY-MM
          totalIncome: {
            $sum: { 
              $cond: [
                { $eq: ["$type", "income"] }, "$amount", 
                // 💡 FIX: ÁP DỤNG QUY ĐỔI TIỀN TỆ
                { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
                0
              ] 
            }
          },
          totalExpense: {
            $sum: {
              $cond: [
                { $eq: ["$type", "expense"] }, "$amount", 
                // 💡 FIX: ÁP DỤNG QUY ĐỔI TIỀN TỆ
                { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
                0
              ] 
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const processedStats = stats.map(item => ({
        monthYear: item._id,
        totalIncome: Number(item.totalIncome.toFixed(0)),
        totalExpense: Number(item.totalExpense.toFixed(0)),
    }));

    res.json(processedStats);
  } catch (error) {
    res.status(500).json({ message: "Lỗi thống kê giao dịch", error });
  }
};
