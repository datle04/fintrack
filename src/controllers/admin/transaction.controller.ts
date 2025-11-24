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
    // 1. Lấy "reason" từ body
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
      userId,
      reason, // <-- LẤY LÝ DO
    } = req.body;

    // 2. Tìm giao dịch GỐC (để so sánh)
    const originalTx = await Transaction.findById(id);
    if (!originalTx) {
      res.status(404).json({ message: "Giao dịch không tồn tại!" });
      return;
    }
    // Lưu lại user ID gốc phòng trường hợp admin đổi chủ sở hữu
    const originalUserId = originalTx.user;

    // (Logic xử lý data và ảnh của bạn giữ nguyên)
    const processedData = await processTransactionData({
      currency, amount, type, category, note, date, isRecurring, recurringDay,
      goalId: goalId || null,
    });
    // ... (logic xử lý keepImages và newUploadedImages giữ nguyên) ...
    let keepImages: string[] = [];
    if (existingImages) {
      keepImages = Array.isArray(existingImages) ? existingImages : [existingImages];
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

    const updateFields: any = {
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
      goalId: processedData.goalId || null,
      user: userId || originalUserId, // Cập nhật user nếu admin chỉ định
    };

    // 3. So sánh thay đổi
    const changes: string[] = [];
    const originalAmountBase = originalTx.amount * (originalTx.exchangeRate || 1);
    const newAmountBase = processedData.amount * (processedData.exchangeRate || 1);

    if (originalAmountBase !== newAmountBase) {
      changes.push(`Số tiền từ <${originalAmountBase}> thành <${newAmountBase}>`);
    }
    if (originalTx.category !== processedData.category) {
      changes.push(`Danh mục từ "<${originalTx.category}>" thành "<${processedData.category}>"`);
    }
    if (originalTx.date !== updateFields.date) {
      changes.push(`Ngày từ <${originalTx.date}> thành <${updateFields.date}>`);
    }
    if (originalTx.note !== processedData.note) {
      changes.push(`Ghi chú (từ "<${originalTx.note || ''}>" thành "<${processedData.note || ''}>")`);
    }
    if (originalUserId.toString() !== updateFields.user.toString()) {
      changes.push(`Chủ sở hữu giao dịch đã bị thay đổi (bởi admin)`);
    }

    // 4. Cập nhật giao dịch
    const updatedTx = await Transaction.findByIdAndUpdate(id, updateFields, {
      new: true,
    });
    // (Lưu ý: updatedTx đã là bản mới, chúng ta dùng originalTx để so sánh)

    // 5. Gửi thông báo (nếu có thay đổi)
    if (changes.length > 0) {
      const txDesc = `[${originalAmountBase} - ${originalTx.category}]`;
      const message = `Một quản trị viên đã cập nhật giao dịch ${txDesc} của bạn.
                       Các thay đổi: ${changes.join(", ")}.
                       ${reason ? `Lý do: ${reason}` : ""}`;

      // 🔥 DÙNG HÀM SERVICE ĐỂ GỬI REAL-TIME
      await createAndSendNotification(
        originalUserId, // Lấy ID user từ budget đã lưu
        "info",                 // Type
        message,                // Message
        "/transaction"           // Link (optional) - để user bấm vào xem
      );

      // Nếu admin đổi chủ sở hữu, cũng thông báo cho user MỚI
      if (originalUserId.toString() !== updatedTx!.user.toString()) {
        await createAndSendNotification(
          updatedTx!.user, // Lấy ID user từ budget đã lưu
          "info",                 // Type
          `Một quản trị viên đã chuyển giao dịch ${txDesc} cho bạn. 
            ${reason ? `Lý do: ${reason}` : ""}`,                // Message
          "/transaction"           // Link (optional) - để user bấm vào xem
        );
      }
    }

    // 6. Ghi Log
    await logAction(req, {
      action: "Admin Update Transaction",
      statusCode: 200,
      description: `Admin đã cập nhật giao dịch ID: ${id}. Lý do: ${reason || "Không có"}. Thay đổi: ${changes.join(", ") || "Không có"}`,
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
    const { id } = req.params;
    const { reason } = req.body; // <-- 2. Lấy lý do từ body (giống banUser)
    const deletedTx = await Transaction.findByIdAndDelete(req.params.id);

    if (!deletedTx) {
      await logAction(req, {
        action: "Xoá giao dịch thất bại",
        statusCode: 404,
        description: `Giao dịch ID ${req.params.id} không tồn tại`,
        level: "warning",
      });

      res.status(404).json({ message: "Không tìm thấy giao dịch" });
      return;
    }

    // --- 4. GỬI THÔNG BÁO CHO NGƯỜI DÙNG VỚI CHI TIẾT ---

    // Format lại dữ liệu cho dễ đọc
    const txAmount = (
      deletedTx.amount * (deletedTx.exchangeRate || 1) // Lấy giá trị đã quy đổi
    ).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
    const txDate = new Date(deletedTx.date).toLocaleDateString("vi-VN");
    const txNote = deletedTx.note
      ? `"${deletedTx.note}"`
      : `(không có ghi chú)`;

    // Tạo thông điệp rõ ràng
    const message = `Một quản trị viên đã xóa giao dịch của bạn: 
                     [${txAmount} - ${deletedTx.category} - ${txDate}]
                     (Ghi chú: ${txNote}). 
                     ${reason ? `Lý do: ${reason}` : ""}`;

    await createAndSendNotification(
      deletedTx.user, // Lấy ID user từ budget đã lưu
      "info",                 // Type
      message,                // Message
      "/transaction"           // Link (optional) - để user bấm vào xem
    );
    // ----------------------------------------------------

    await logAction(req, {
      action: "Xoá giao dịch",
      statusCode: 200,
      description: `Đã xoá giao dịch ID ${id}`,
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