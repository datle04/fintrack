import { Response } from "express";
import { AuthRequest } from "../middlewares/requireAuth";
import cloudinary from "../utils/cloudinary";
import User from "../models/User";
import { logAction } from "../utils/logAction";

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const { name, dob, phone, address, currency, avatarUrl } = req.body;

    const updateFields: any = {};

    if (name !== undefined) updateFields.name = name;
    if (dob !== undefined) updateFields.dob = dob;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (currency !== undefined) updateFields.currency = currency;

    if (req.file) {
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(base64, {
        folder: "fintrack_avatars",
        public_id: `avatar-${userId}`, 
        overwrite: true,
        resource_type: "image"
      });
      updateFields.avatarUrl = uploadResult.secure_url;
    } 
    else if (avatarUrl === "") {
      updateFields.avatarUrl = ""; 
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true } 
    ).select("-password -otp -otpExpires"); 

    if (!updatedUser) {
      res.status(404).json({ message: "Người dùng không tồn tại" });
      return;
    }

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

export const getUserInfo = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId).select('-password -refreshToken'); 

    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng' });
      return;
    }

    res.status(200).json({
      id: user._id,
      name: user.name,
      email: user.email,
      dob: user.dob,
      avatarUrl: user.avatarUrl,
      currency: user.currency,
      role: user.role,
      address: user.address,
      phone: user.phone, 
    });
  } catch (err) {
    console.error('❌ Lỗi khi lấy thông tin người dùng:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
