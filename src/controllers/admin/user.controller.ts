import User from "../../models/User";
import { Request, Response } from "express";
import { logAction } from "../../utils/logAction";

export const getAllUsers = async (req: Request, res: Response) => {
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
      .select("-password")
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

  res.json({ message: "Đã xoá người dùng thành công", user });
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

