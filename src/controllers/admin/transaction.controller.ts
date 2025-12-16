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
  const {
    userId, // Dùng cho filter dropdown (nếu có)
    type,
    category,
    startDate,
    endDate,
    keyword, // Nhận từ ô input search
    page = 1,
    limit = 20,
  } = req.query;

  const query: any = {};

  // 1. Filter cơ bản
  if (userId) query.userId = userId;
  if (type) query.type = type;
  if (category) query.category = category;
  
  if (startDate && endDate) {
    query.date = {
      $gte: getStartOfDay(startDate as string),
      $lte: getEndOfDay(endDate as string),
    };
  }

  // 2. XỬ LÝ SEARCH THÔNG MINH (KEYWORD)
  if (keyword) {
    const searchString = keyword as string;
    const searchRegex = { $regex: searchString, $options: "i" };
    
    const orConditions: any[] = [];

    // 1. Check ID hợp lệ
    if (mongoose.Types.ObjectId.isValid(searchString)) {
        console.log("✅ Keyword là ObjectId hợp lệ:", searchString);
        // Lưu ý: Phải ép kiểu sang ObjectId nếu dùng Mongoose raw query đôi khi cần thiết
        orConditions.push({ user: new mongoose.Types.ObjectId(searchString) }); 
        orConditions.push({ _id: new mongoose.Types.ObjectId(searchString) });
    } else {
        console.log("❌ Keyword KHÔNG phải ObjectId");
    }

    // B. Tìm theo Note (Ghi chú giao dịch)
    orConditions.push({ note: searchRegex });

    // 3. Tìm User
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

    // --- 👇 QUAN TRỌNG: IN RA QUERY CUỐI CÙNG ---
  console.log("🚀 FINAL QUERY:", JSON.stringify(query, null, 2));
  }

  // ... (Phần sort, skip, limit giữ nguyên)
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

    // 1. Chỉ lấy những trường Admin ĐƯỢC PHÉP sửa
    const {
      note,
      existingImages,
      reason, // Bắt buộc phải có lý do
    } = req.body;

    // 2. Tìm giao dịch GỐC
    const originalTx = await Transaction.findById(id);
    if (!originalTx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }

    // -------------------------------------------------------------
    // 3. XỬ LÝ ẢNH (Logic giữ nguyên vì Admin được quyền sửa bằng chứng)
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // 4. CHUẨN BỊ DỮ LIỆU UPDATE (LỌC BỎ CÁC TRƯỜNG TÀI CHÍNH)
    // -------------------------------------------------------------
    // Tuyệt đối KHÔNG đưa amount, currency, category, date, goalId vào đây
    const updateFields: any = {
      note: note, // Cho phép sửa ghi chú
      receiptImage: finalImages, // Cho phép sửa ảnh
      // Không update user, amount, date...
    };

    // -------------------------------------------------------------
    // 5. SO SÁNH THAY ĐỔI (CHỈ LOG NHỮNG GÌ THỰC SỰ ĐỔI)
    // -------------------------------------------------------------
    const changes: string[] = [];

    if ((originalTx.note || "") !== (note || "")) {
      changes.push(`Ghi chú (từ "${originalTx.note || ''}" thành "${note || ''}")`);
    }

    // So sánh ảnh đơn giản qua độ dài mảng (hoặc logic phức tạp hơn nếu cần)
    if (originalTx.receiptImage?.length !== finalImages.length) {
      changes.push(`Ảnh hóa đơn (thay đổi số lượng từ ${originalTx.receiptImage?.length} thành ${finalImages.length})`);
    } else {
        // Nếu độ dài bằng nhau, kiểm tra xem nội dung có khác không (sơ bộ)
        const oldImagesJson = JSON.stringify(originalTx.receiptImage.sort());
        const newImagesJson = JSON.stringify(finalImages.sort());
        if (oldImagesJson !== newImagesJson) {
             changes.push(`Cập nhật ảnh chứng từ`);
        }
    }

    // Nếu không có gì thay đổi thì báo luôn (Tiết kiệm db write)
    if (changes.length === 0) {
        res.status(200).json({ message: "Không có thay đổi nào được thực hiện." });
        return;
    }

    // -------------------------------------------------------------
    // 6. CẬP NHẬT DATABASE
    // -------------------------------------------------------------
    const updatedTx = await Transaction.findByIdAndUpdate(
        id, 
        { $set: updateFields }, 
        { new: true }
    );

    // -------------------------------------------------------------
    // 7. GỬI THÔNG BÁO CHO USER
    // -------------------------------------------------------------
    // Tạo tiêu đề ngắn gọn để user nhận diện giao dịch
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

    // -------------------------------------------------------------
    // 8. GHI LOG HỆ THỐNG
    // -------------------------------------------------------------
    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 200,
      description: `Admin cập nhật giao dịch ID: ${id}. Lý do: ${reason}`,
      
      // 👇 Metadata giúp bạn lưu chi tiết kỹ thuật mà không làm rối description
      metadata: {
        targetId: id,               // ID của giao dịch bị sửa
        reason: reason,             // Lý do
        changes: changes,           // Mảng các thay đổi ["Ghi chú từ A -> B"]
        originalData: originalTx,   // (Tùy chọn) Lưu luôn bản gốc để backup nếu cần
        adminIp: req.ip             // IP của admin thực hiện
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

export const deleteTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body; 

    // Xóa giao dịch và lấy về document vừa xóa
    const deletedTx = await Transaction.findByIdAndDelete(id);

    if (!deletedTx) {
      await logAction(req, {
        action: "Xoá giao dịch thất bại",
        statusCode: 404,
        description: `Giao dịch ID ${id} không tồn tại`,
        level: "warning",
      });

      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    // --- Cập nhật lại goal (rollback) --- 
    if (deletedTx.goalId) {
      await recalculateGoalProgress(deletedTx.goalId);
      console.log(`[Admin] Đã cập nhật lại tiến độ cho Goal ${deletedTx.goalId} sau khi xóa giao dịch.`);
    }
    // --------------------------------------------------------

    // --- 4. GỬI THÔNG BÁO CHO NGƯỜI DÙNG VỚI CHI TIẾT ---
    const txAmount = (
      deletedTx.amount * (deletedTx.exchangeRate || 1)
    ).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
    
    const txDate = new Date(deletedTx.date).toLocaleDateString("vi-VN");
    const txNote = deletedTx.note ? `"${deletedTx.note}"` : `(không có ghi chú)`;

    const message = `Một quản trị viên đã xóa giao dịch của bạn: 
                     [${txAmount} - ${deletedTx.category} - ${txDate}]
                     (Ghi chú: ${txNote}). 
                     ${reason ? `Lý do: ${reason}` : ""}`;

    await createAndSendNotification(
      deletedTx.user, 
      "info", 
      message, 
      "/transaction" 
    );

    // Ghi Log
    await logAction(req, {
      action: "Xoá giao dịch",
      statusCode: 200,
      description: `Đã xoá giao dịch ID ${id}. Lý do: ${reason || "Không có"}`,
      level: "info",
    });

    res.json({ message: "Đã xoá giao dịch và cập nhật dữ liệu liên quan" });

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

export const getTransactionStats = async (req: AuthRequest, res: Response) => {
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