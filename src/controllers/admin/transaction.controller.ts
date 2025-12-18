import Transaction from "../../models/Transaction";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";
import { AuthRequest } from "../../middlewares/requireAuth";
import cloudinary from "../../utils/cloudinary";
import { v4 as uuid } from 'uuid';
import { getExchangeRate } from "../../services/exchangeRate";
import { getEndOfDay, getStartOfDay } from "../../utils/dateHelper";
import Notification from "../../models/Notification";
import { createAndSendNotification } from "../../services/notification.service";
import { recalculateGoalProgress } from "../../services/goal.service";
import Goal from "../../models/Goal";
import User from "../../models/User";
import mongoose from "mongoose";
import { checkBudgetAlertForUser } from "../../services/budget.service";

const processTransactionData = async (data: any) => {
    const transactionCurrency = (data.currency || 'VND').toUpperCase();
    let exchangeRate = 1;

    if (transactionCurrency !== 'VND') {
        exchangeRate = await getExchangeRate(transactionCurrency); 
        
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
  const {
    userId, 
    type,
    category,
    startDate,
    endDate,
    keyword, 
    page = 1,
    limit = 20,
  } = req.query;

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
    const searchString = keyword as string;
    const searchRegex = { $regex: searchString, $options: "i" };
    
    const orConditions: any[] = [];

    if (mongoose.Types.ObjectId.isValid(searchString)) {
        console.log("✅ Keyword là ObjectId hợp lệ:", searchString);
        orConditions.push({ user: new mongoose.Types.ObjectId(searchString) }); 
        orConditions.push({ _id: new mongoose.Types.ObjectId(searchString) });
    } else {
        console.log("❌ Keyword KHÔNG phải ObjectId");
    }

    orConditions.push({ note: searchRegex });

    const matchingUsers = await User.find({
      $or: [{ name: searchRegex }, { email: searchRegex }],
    }).select("_id");
    
    if (matchingUsers.length > 0) {
       console.log("🔍 Tìm thấy Users khớp tên/email:", matchingUsers.length);
       orConditions.push({ userId: { $in: matchingUsers.map(u => u._id) } });
    }

    if (orConditions.length > 0) {
        query.$or = orConditions;
    }

  console.log("🚀 FINAL QUERY:", JSON.stringify(query, null, 2));
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


export const adminUpdateTransaction = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const {
      note,
      existingImages,
      reason, 
    } = req.body;

    const originalTx = await Transaction.findById(id);
    if (!originalTx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    let keepImages: string[] = [];
    if (existingImages) {
      keepImages = Array.isArray(existingImages) ? existingImages : [existingImages];
    }

    let newUploadedImages: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      const uploadPromises = (req.files as Express.Multer.File[]).map(
        (file) => {
          const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
          return cloudinary.uploader.upload(base64, {
            folder: "fintrack_receipts",
            public_id: `receipt-${uuid()}`,
          });
        }
      );
      const results = await Promise.all(uploadPromises);
      newUploadedImages = results.map((result) => result.secure_url);
    }
    
    const finalImages = [...keepImages, ...newUploadedImages];

    const updateFields: any = {
      note: note, 
      receiptImage: finalImages,
    };

    const changes: string[] = [];

    if ((originalTx.note || "") !== (note || "")) {
      changes.push(`Ghi chú (từ "${originalTx.note || ''}" thành "${note || ''}")`);
    }

    if (originalTx.receiptImage?.length !== finalImages.length) {
      changes.push(`Ảnh hóa đơn (thay đổi số lượng từ ${originalTx.receiptImage?.length} thành ${finalImages.length})`);
    } else {
        const oldImagesJson = JSON.stringify(originalTx.receiptImage.sort());
        const newImagesJson = JSON.stringify(finalImages.sort());
        if (oldImagesJson !== newImagesJson) {
             changes.push(`Cập nhật ảnh chứng từ`);
        }
    }

    if (changes.length === 0) {
        res.status(200).json({ message: "Không có thay đổi nào được thực hiện." });
        return;
    }

    const updatedTx = await Transaction.findByIdAndUpdate(
        id, 
        { $set: updateFields }, 
        { new: true }
    );

    const txDesc = `[${originalTx.amount.toLocaleString()} ${originalTx.currency}]`; 
    
    const message = `Admin đã cập nhật thông tin bổ sung (Ghi chú/Ảnh) cho giao dịch ${txDesc}.
                     Thay đổi: ${changes.join(", ")}.
                     ${reason ? `Lý do: ${reason}` : ""}`;

    await createAndSendNotification(
      originalTx.user, 
      "info", 
      message, 
      "/transaction"
    );

    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 200,
      description: `Admin cập nhật giao dịch ID: ${id}. Lý do: ${reason}`,

      metadata: {
        targetId: id,              
        reason: reason,            
        changes: changes,         
        originalData: originalTx,  
        adminIp: req.ip             
      }
    });

    res.json(updatedTx);

  } catch (error) {
    console.error("❌ Lỗi khi admin cập nhật giao dịch:", error);
    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 500,
      description: "Lỗi hệ thống khi admin cập nhật",
      level: "error",
    });
    res.status(500).json({ message: "Không thể cập nhật!", error });
  }
};

export const adminDeleteTransaction = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body; 

  try {
    if (!reason || reason.trim().length === 0) {
       res.status(400).json({ message: "Admin bắt buộc phải nhập lý do khi xóa giao dịch." });
       return;
    }

    const txToDelete = await Transaction.findById(id);

    if (!txToDelete) {
       res.status(404).json({ message: "Giao dịch không tồn tại." });
       return;
    }

    await Transaction.findByIdAndDelete(id);
    
    if (txToDelete.goalId) {
      await recalculateGoalProgress(txToDelete.goalId);
      console.log(`[Admin] Đã cập nhật lại tiến độ Goal ${txToDelete.goalId} sau khi xóa Tx.`);
    }

    if (txToDelete.user) {
        await checkBudgetAlertForUser(txToDelete.user.toString());
    }
    const txAmount = (
      txToDelete.amount * (txToDelete.exchangeRate || 1)
    ).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
    
    const txDate = new Date(txToDelete.date).toLocaleDateString("vi-VN");

    const message = `Admin đã xóa giao dịch: [${txAmount} - ${txToDelete.category} - ${txDate}].
                     ${reason ? `Lý do: ${reason}` : ""}`;

    await createAndSendNotification(
      txToDelete.user, 
      "info", 
      message, 
      "/transaction" 
    );

    await logAction(req, {
      action: "Admin Delete Transaction",
      statusCode: 200,
      description: `Admin xóa giao dịch ID ${id}. Lý do: ${reason}`,
      level: "critical", 
      metadata: {
        deletedTransaction: txToDelete.toObject(), 
        reason: reason,
        deletedByAdmin: true
      }
    });

    res.json({ message: "Đã xoá giao dịch và cập nhật dữ liệu liên quan." });

  } catch (error) {
    console.error("❌ Lỗi xoá giao dịch:", error);
    
    await logAction(req, {
      action: "Admin Delete Transaction",
      statusCode: 500,
      description: `Lỗi server khi xoá giao dịch ID ${id}`,
      level: "error",
      metadata: { error: error }
    });

    res.status(500).json({ message: "Lỗi server" });
  }
};

export const getTransactionStats = async (req: AuthRequest, res: Response) => {
  try {
    const totalIncome = await Transaction.aggregate([
      { $match: { type: "income" } },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
          },
        },
      },
    ]);

    const totalExpense = await Transaction.aggregate([
      { $match: { type: "expense" } },
      {
        $group: {
          _id: null,
          total: {
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