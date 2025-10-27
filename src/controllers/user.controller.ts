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
