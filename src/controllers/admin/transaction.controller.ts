import Transaction from "../../models/Transaction";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";
import { AuthRequest } from "../../middlewares/requireAuth";
import cloudinary from "../../utils/cloudinary";
import { v4 as uuid } from 'uuid';

export const getAllTransactions = async (req: AuthRequest, res: Response) => {
  const {userId, type, category, startDate, endDate, keyword, page = 1,limit = 20,} = req.query;

  const query: any = {};

  if (userId) query.userId = userId;
  if (type) query.type = type;
  if (category) query.category = category;
  if (startDate && endDate) {
    query.date = {
      $gte: new Date(startDate as string),
      $lte: new Date(endDate as string),
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
    const { amount, type, category, note, date, isRecurring, recurringDay, existingImages } = req.body;

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

    const isRecurringBool = isRecurring === "true" || isRecurring === true;

    if (isRecurringBool && (recurringDay < 1 || recurringDay > 31)) {
      return res.status(400).json({ message: "Ngày định kỳ không hợp lệ" });
    }

    const finalImages = [...keepImages, ...newUploadedImages];

    const updatedTx = await Transaction.findByIdAndUpdate(
      id,
      {
        amount,
        type,
        category,
        note,
        date: date ? new Date(date) : undefined,
        isRecurring: isRecurringBool,
        recurringDay: isRecurringBool ? recurringDay : undefined,
        receiptImage: finalImages,
      },
      { new: true }
    ).populate("user", "-password"); // ⚠️ Trả object user đầy đủ

    if (!updatedTx) {
      return res.status(404).json({ message: "Giao dịch không tồn tại!" });
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
            $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: "Lỗi thống kê giao dịch", error });
  }
};
