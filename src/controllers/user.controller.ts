import { Response } from "express";
import { AuthRequest } from "../middlewares/requireAuth";
import cloudinary from "../utils/cloudinary";
import User from "../models/User";
import { logAction } from "../utils/logAction";

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    // 1. Lấy dữ liệu từ Body (đã qua Joi validate nếu có)
    const { name, dob, phone, address, currency, avatarUrl } = req.body;

    // 2. Chuẩn bị object update
    // Dùng kiểu any hoặc Partial<IUser> để linh hoạt
    const updateFields: any = {};

    // 3. Logic Mapping dữ liệu (Hỗ trợ xóa dữ liệu bằng chuỗi rỗng)
    // Kiểm tra undefined để biết user CÓ GỬI trường đó lên không
    if (name !== undefined) updateFields.name = name;
    if (dob !== undefined) updateFields.dob = dob;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (currency !== undefined) updateFields.currency = currency;

    // 4. Xử lý Avatar (Logic ưu tiên)
    // TH1: Có file upload lên -> Upload Cloudinary và lấy URL mới
    if (req.file) {
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(base64, {
        folder: "fintrack_avatars",
        public_id: `avatar-${userId}`, // Giữ ID cố định để tự ghi đè ảnh cũ
        overwrite: true,
        resource_type: "image"
      });
      updateFields.avatarUrl = uploadResult.secure_url;
    } 
    // TH2: Không upload file, nhưng gửi avatarUrl = "" -> Muốn xóa avatar
    else if (avatarUrl === "") {
      updateFields.avatarUrl = ""; 
      // Tùy chọn: Có thể gọi cloudinary.uploader.destroy(...) để xóa ảnh trên cloud nếu muốn tiết kiệm
    }
    // TH3: Không làm gì cả -> Giữ nguyên avatar cũ (không thêm vào updateFields)

    // 5. Cập nhật Database
    // $set chỉ cập nhật các trường có trong updateFields
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true } // Trả về user mới sau khi update
    ).select("-password -otp -otpExpires"); // Loại bỏ các trường nhạy cảm

    if (!updatedUser) {
      res.status(404).json({ message: "Người dùng không tồn tại" });
      return;
    }

    // 6. Log hành động
    await logAction(req, {
      action: "Cập nhật hồ sơ",
      statusCode: 200,
      description: `User ${userId} đã cập nhật thông tin cá nhân`,
    });

    res.json(updatedUser);

  } catch (error) {
    console.error("❌ Lỗi update profile:", error);
    
    await logAction(req, {
      action: "Cập nhật hồ sơ",
      statusCode: 500,
      description: "Lỗi hệ thống khi cập nhật hồ sơ",
      level: "error",
    });

    res.status(500).json({ message: "Không thể cập nhật hồ sơ", error });
  }
};

// --- HÀM GET USER INFO MỚI ---
export const getUserInfo = async (req: AuthRequest, res: Response) => {
  try {
    // userId đã được gắn vào req bởi middleware requireAuth
    const userId = req.userId;

    const user = await User.findById(userId).select('-password -refreshToken'); // Luôn loại bỏ password

    if (!user) {
      // Trường hợp hiếm gặp nếu user bị xóa sau khi token được cấp
      res.status(404).json({ message: 'Không tìm thấy người dùng' });
      return;
    }

    // Chỉ trả về các trường an toàn
    res.status(200).json({
      id: user._id,
      name: user.name,
      email: user.email,
      dob: user.dob,
      avatarUrl: user.avatarUrl,
      currency: user.currency,
      role: user.role,
      address: user.address, //
      phone: user.phone, //
      // Thêm các trường khác nếu cần và đảm bảo chúng an toàn
    });
  } catch (err) {
    console.error('❌ Lỗi khi lấy thông tin người dùng:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
