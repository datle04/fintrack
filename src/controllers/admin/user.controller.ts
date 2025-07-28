import User from "../../models/User";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";

export const getAllUsers = async (req: Request, res: Response) => {
  const users = await User.find().select("-password");
  res.json(users);
};

export const deleteUser = async (req: Request, res: Response) => {
  const user = await User.findByIdAndDelete(req.params.userId);

  if (!user) {
    await logAction(req, {
      action: "DELETE_USER_FAILED",
      statusCode: 404,
      description: `Không tìm thấy người dùng có ID ${req.params.userId}`,
      level: "warning"
    });
    res.status(404).json({ message: "Không tìm thấy người dùng" });
    return;
  }

  await logAction(req, {
    action: "DELETE_USER",
    statusCode: 200,
    description: `Đã xóa người dùng ${user.name} (${user._id})`,
    level: "critical"
  });

  res.json({ message: "Đã xoá người dùng thành công" });
};

export const updateUserInfo = async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(req.params.userId, req.body, { new: true });

  if (!user) {
    await logAction(req, {
      action: "UPDATE_USER_FAILED",
      statusCode: 404,
      description: `Không tìm thấy người dùng để cập nhật: ID ${req.params.userId}`,
      level: "warning"
    });
    res.status(404).json({ message: "Không tìm thấy người dùng" });
    return;
  }

  await logAction(req, {
    action: "UPDATE_USER",
    statusCode: 200,
    description: `Cập nhật thông tin người dùng ${user.name} (${user._id})`,
    level: "info"
  });

  res.json(user);
};


export const banUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
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

