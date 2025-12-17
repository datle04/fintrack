import User from "../../models/User";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";
import Transaction from "../../models/Transaction";
import Budget from "../../models/Budget";
import Goal from "../../models/Goal";
import Log from "../../models/Log";
import Notification from "../../models/Notification";
import { ReportModel } from "../../models/Report";
import { SessionModel } from "../../models/Session";
import cloudinary from "../../utils/cloudinary";
import ChatHistory from "../../models/ChatHistory";
import path from "path";
import fs from 'fs';
import { AuthRequest } from "../../middlewares/requireAuth";
import { sendEmail } from "../../utils/sendEmail";
import { createAndSendNotification } from "../../services/notification.service";

export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const {id,name,email,role,isBanned,page = 1,limit = 10,} = req.query;

    const query: any = {};

    if (id) query._id = id;
    if (role) query.role = role;
    if (isBanned !== undefined) query.isBanned = isBanned === "true";

    const orConditions = [];
    if (name) orConditions.push({ name: { $regex: name, $options: "i" } });
    if (email) orConditions.push({ email: { $regex: email, $options: "i" } });
    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select("-password -refreshToken")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    res.json({
      users,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalUsers: total,
    });
  } catch (err) {
    console.error("❌ Error in getAllUsers:", err);
    res.status(500).json({ message: "Lỗi server!" });
  }
};

export const updateUserInfo = async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  
  // 1. CHỈ LẤY ROLE VÀ REASON
  // Các trường name, email, currency... sẽ bị lờ đi hoàn toàn
  const {
    role,
    reason, // <-- Bắt buộc
  } = req.body;

  try {
    // 2. Validate Input
    if (!reason || reason.trim().length === 0) {
        res.status(400).json({ message: "Admin bắt buộc phải nhập lý do khi thay đổi quyền hạn người dùng." });
        return;
    }

    // 3. Tìm user GỐC
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "Không tìm thấy người dùng" });
      return;
    }

    // 4. So sánh thay đổi (Chỉ so sánh Role)
    const changes: string[] = [];
    const oldRole = user.role;

    if (role && role !== user.role) {
      // Validate role hợp lệ nếu cần (ví dụ: chỉ cho phép 'user', 'admin')
      const validRoles = ['user', 'admin']; 
      if (!validRoles.includes(role)) {
          res.status(400).json({ message: "Vai trò không hợp lệ." });
          return;
      }

      changes.push(`Vai trò từ "${user.role}" thành "${role}"`);
      user.role = role;
    }

    // Nếu không có gì thay đổi
    if (changes.length === 0) {
      res.status(400).json({ 
          message: "Không có thay đổi nào về quyền hạn. Admin không được phép sửa thông tin cá nhân khác." 
      });
      return;
    }

    // 5. Lưu thay đổi
    const updatedUser = await user.save();

    // 6. Gửi thông báo & Email (Bảo mật)
    const message = `Quản trị viên đã thay đổi quyền hạn tài khoản của bạn.
                     Chi tiết: ${changes.join(", ")}.
                     Lý do: ${reason}`;
                     
    // 6a. Thông báo trong app
    await createAndSendNotification(
      userId,        
      "info",      // Dùng warning vì đổi role là hành động nhạy cảm
      message,                
      "/setting"           
    );

    // 6b. Gửi email (Rất quan trọng khi đổi Role)
    sendEmail({
        to: user.email, 
        subject: "[FinTrack] Cảnh báo: Thay đổi quyền hạn tài khoản",
        html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h3 style="color: #d9534f;">Thay đổi quyền truy cập</h3>
                <p>Xin chào <b>${user.name}</b>,</p>
                <p>Tài khoản của bạn vừa được cập nhật quyền hạn bởi quản trị viên.</p>
                <ul>
                    <li><b>Thay đổi:</b> ${changes.join(", ")}</li>
                    <li><b>Lý do:</b> ${reason}</li>
                </ul>
                <p>Nếu bạn cho rằng đây là sự nhầm lẫn, vui lòng liên hệ bộ phận hỗ trợ.</p>
              </div>`
    });

    // 7. Ghi Log Audit (Kèm Snapshot)
    await logAction(req, {
      action: "Admin Update User Role",
      statusCode: 200,
      description: `Admin cập nhật Role user ID ${userId}. Lý do: ${reason}`,
      level: "warning",
      metadata: {
        targetUserId: userId,
        oldRole: oldRole,
        newRole: role,
        reason: reason,
        adminIp: req.ip
      }
    });

    // Trả về user (nhưng nên lọc bỏ password nếu có)
    const userResponse = updatedUser.toObject();

    res.json(userResponse);

  } catch (error) {
    console.error("❌ Lỗi khi admin cập nhật user:", error);
    await logAction(req, {
      action: "Admin Update User Role",
      statusCode: 500,
      description: `Lỗi khi cập nhật role user ID: ${userId}`,
      level: "error",
      metadata: { error }
    });
    res.status(500).json({ message: "Lỗi server", error });
  }
};


export const banUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    // Lấy lý do cấm (nếu có) từ body
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(userId, { isBanned: true }, { new: true });

    if (!user) {
      await logAction(req, {
        action: "BAN_USER_FAILED",
        statusCode: 404,
        description: `Không tìm thấy người dùng để khóa: ID ${userId}`,
        level: "warning"
      });
      res.status(404).json({ message: "Không tìm thấy người dùng" });
      return;
    }

    // --- 2. GỬI EMAIL THÔNG BÁO CẤM ---
    // Gửi "bất đồng bộ" (không cần await) để không làm chậm response của admin
    sendEmail({
      to: user.email, //
      subject: "[FinTrack] Tài khoản của bạn đã bị khóa",
      html: `
        <p>Chào ${user.name},</p>
        <p>Chúng tôi rất tiếc phải thông báo rằng tài khoản FinTrack của bạn đã bị khóa bởi quản trị viên.</p>
        ${reason ? `<p><b>Lý do:</b> ${reason}</p>` : ''}
        <p>Nếu bạn tin rằng đây là một sự nhầm lẫn, vui lòng liên hệ với bộ phận hỗ trợ của chúng tôi. Bạn có 30 ngày trước khi tài khoản của bạn bị xóa vĩnh viễn.</p>
        <p>Trân trọng,<br/>Đội ngũ FinTrack</p>
      `,
    }).catch(err => console.error(`[EmailService] Gửi email cấm user ${user._id} thất bại:`, err));
    // ---------------------------------

    await logAction(req, {
      action: "BAN_USER",
      statusCode: 200,
      description: `Người dùng ${user.name} (${user._id}) đã bị khóa`,
      level: "critical"
    });

    res.json({ message: "Người dùng đã bị khóa", user });
  } catch (error) {
    await logAction(req, {
      action: "BAN_USER_ERROR",
      statusCode: 500,
      description: `Lỗi khi khóa người dùng ${req.params.userId}`,
      level: "error"
    });
    res.status(500).json({ message: "Lỗi khóa tài khoản", error });
  }
};

// --- API MỚI ĐƯỢC BỔ SUNG ---
export const unbanUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const user = await User.findByIdAndUpdate(
      userId,
      { isBanned: false }, //
      { new: true }
    ).select("-password");

    if (!user) {
      res.status(404).json({ message: "Không tìm thấy user" });
      return;
    }

    // --- 2. GỬI EMAIL THÔNG BÁO GỠ CẤM ---
    // Gửi "bất đồng bộ" (không cần await) để không làm chậm response của admin
    sendEmail({
      to: user.email, //
      subject: "[FinTrack] Tài khoản của bạn đã được mở khóa",
      html: `
        <p>Chào ${user.name},</p>
        <p>Chúng tôi xin thông báo rằng tài khoản FinTrack của đã được mở khóa lại bởi quản trị viên.</p>
        <p>Chúng tôi mong bạn sẽ sử dụng app một cách rõ ràng, minh bạch.</p>
        <p>Trân trọng,<br/>Đội ngũ FinTrack</p>
      `,
    }).catch(err => console.error(`[EmailService] Gửi email gỡ cấm user ${user._id} thất bại:`, err));
    // ---------------------------------

    await logAction(req, {
      action: "Admin Unban User",
      statusCode: 200,
      description: `Admin đã gỡ cấm user ID: ${userId}`,
    });

    res.json({ message: "Đã gỡ cấm user thành công", user });
  } catch (err) {
    console.error("❌ Lỗi khi gỡ cấm user (admin):", err);
    await logAction(req, {
      action: "Admin Unban User",
      statusCode: 500,
      description: `Lỗi khi gỡ cấm user ID: ${req.params.userId}`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server" });
  }
};

// --- HÀM DELETEUSER ĐÃ ĐƯỢC CẬP NHẬT ---
export const deleteUser = async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;

  try {
    // 1. Kiểm tra user tồn tại
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "Không tìm thấy user" });
      return;
    }

    // 2. Thu thập và Xóa các file bên ngoài (Cloudinary, PDF)
    // (Làm việc này trước, nếu thất bại, chúng ta không xóa CSDL)

    // 2a. Xóa ảnh hóa đơn trên Cloudinary
    const transactions = await Transaction.find({ user: userId });
    if (transactions.length > 0) {
      const publicIds = transactions
        .flatMap((tx) => tx.receiptImage) // Lấy mảng các URL
        .map((url) => {
          // Trích xuất public_id từ URL Cloudinary
          // Ví dụ: .../fintrack_receipts/receipt-uuid
          const parts = url!.split("/");
          const public_id =
            parts[parts.length - 2] + "/" + parts[parts.length - 1].split(".")[0];
          return public_id;
        })
        .filter(Boolean); // Lọc ra các public_id hợp lệ

      if (publicIds.length > 0) {
        await cloudinary.api.delete_resources(publicIds);
        console.log(`[DeleteUser] Đã xóa ${publicIds.length} ảnh Cloudinary của user ${userId}`);
      }
    }

    // 2b. Xóa file báo cáo PDF
    const reports = await ReportModel.find({ userId: userId });
    if (reports.length > 0) {
      let deleteCount = 0;
      reports.forEach((report) => {
        // Đường dẫn file: static/reports/filename.pdf -> public/reports/filename.pdf
        const filePath = path.join(
          __dirname,
          "../../../public", // Đi ngược 3 cấp từ /dist/controllers/admin
          report.filePath.replace("static/", "")
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deleteCount++;
        }
      });
      console.log(`[DeleteUser] Đã xóa ${deleteCount} file PDF của user ${userId}`);
    }

    // 3. Xóa toàn bộ dữ liệu CSDL (chạy song song cho nhanh)
    await Promise.all([
      Transaction.deleteMany({ user: userId }),
      Budget.deleteMany({ user: userId }),
      Goal.deleteMany({ user: userId }),
      Notification.deleteMany({ user: userId }),
      SessionModel.deleteMany({ userId: userId }),
      Log.deleteMany({ user: userId }),
      ReportModel.deleteMany({ userId: userId }),
      ChatHistory.deleteMany({ userId: userId }),
    ]);

    // 4. Xóa User (Sau khi đã xóa hết dữ liệu liên quan)
    await User.findByIdAndDelete(userId);

    // --- 2. GỬI EMAIL THÔNG BÁO XÓA TÀI KHOẢN---
    // Gửi "bất đồng bộ" (không cần await) để không làm chậm response của admin
    sendEmail({
      to: user.email, //
      subject: "[FinTrack] Tài khoản của bạn đã bị xóa",
      html: `
        <p>Chào ${user.name},</p>
        <p>Chúng tôi xin thông báo rằng tài khoản FinTrack của đã bị xóa.</p><
        <p>Trân trọng,<br/>Đội ngũ FinTrack</p>
      `,
    }).catch(err => console.error(`[EmailService] Gửi email gỡ cấm user ${user._id} thất bại:`, err));
    // -----

    await logAction(req, {
      action: "Admin Delete User",
      statusCode: 200,
      description: `Admin đã xóa user ID: ${userId} và toàn bộ dữ liệu liên quan`,
    });

    res.json({ id: userId, message: "Đã xóa user và tất cả dữ liệu liên quan thành công" });
  } catch (err) {
    console.error("❌ Lỗi khi xóa user (admin):", err);
    await logAction(req, {
      action: "Admin Delete User",
      statusCode: 500,
      description: `Lỗi khi xóa user ID: ${req.params.userId}`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server" });
  }
};