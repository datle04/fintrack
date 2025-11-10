import { Response } from "express";
import { AuthRequest } from "../middlewares/requireAuth";
import cloudinary from "../utils/cloudinary";
import User from "../models/User";
import { logAction } from "../utils/logAction";

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { name, dob, phone, address, currency } = req.body;
    let avatarUrl = "";

    // Nếu có ảnh mới được upload
    if (req.file) {
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(base64, {
        folder: "fintrack_avatars",
        public_id: `avatar-${req.userId}`,
        overwrite: true,
      });
      avatarUrl = uploadResult.secure_url;
    }

    const updateFields: Partial<{
      name: string;
      avatarUrl: string;
      dob: Date;
      phone: string;
      address: string;
      currency: string;
    }> = {};

    if (name) updateFields.name = name;
    if (avatarUrl) updateFields.avatarUrl = avatarUrl;
    if (dob) updateFields.dob = dob;
    if (phone) updateFields.phone = phone;
    if (address) updateFields.address = address;
    if (currency) updateFields.currency = currency;

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { $set: updateFields },
      { new: true }
    ).select("-password");

    await logAction(req, {
      action: "Cập nhật hồ sơ",
      statusCode: 200,
      description: "Người dùng cập nhật hồ sơ thành công",
    });

    res.json(updatedUser);
  } catch (error) {
    await logAction(req, {
      action: "Cập nhật hồ sơ",
      statusCode: 500,
      description: "Cập nhật hồ sơ thất bại",
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
