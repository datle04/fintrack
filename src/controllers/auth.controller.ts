import { Request, Response } from 'express';
import User from '../models/User';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logAction } from '../utils/logAction';

const JWT_SECRET = process.env.JWT_SECRET!;

export const register = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) {
      await logAction(req, {
        action: "register_failed",
        statusCode: 400,
        description: `Email đã tồn tại: ${email}`,
        level: "warning",
      });
        res.status(400).json({ message: "Email đã tồn tại" });
        return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    await logAction(req, {
      action: "register_success",
      statusCode: 201,
      description: `Đăng ký thành công: ${email}`,
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        currency: "VND",
        avatar: user.avatarUrl,
        role: user.role,
        dob: user.dob,
        phone: user.phone,
        address: user.address,
        isBanned: user.isBanned,
      },
    });
  } catch (err) {
    await logAction(req, {
      action: "register_error",
      statusCode: 500,
      description: "Lỗi máy chủ khi đăng ký",
      level: "error",
    });
    res.status(500).json({ message: "Đăng ký thất bại!", error: err });
  }
};

// Đăng nhập
export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      await logAction(req, {
        action: "login_failed",
        statusCode: 400,
        description: `Email chưa đăng ký: ${email}`,
        level: "warning",
      });
      res.status(400).json({ message: "Email chưa được đăng ký!" });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await logAction(req, {
        action: "login_failed",
        statusCode: 404,
        description: `Sai mật khẩu: ${email}`,
        level: "warning",
      });
      return res.status(404).json({ message: "Sai mật khẩu!" });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    await logAction(req, {
      action: "login_success",
      statusCode: 201,
      description: `Đăng nhập thành công: ${email}`,
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        currency: user.currency,
        avatar: user.avatarUrl,
        role: user.role,
        dob: user.dob,
        phone: user.phone,
        address: user.address,
        isBanned: user.isBanned,
      },
    });
  } catch (err) {
    console.log(err);
    await logAction(req, {
      action: "login_error",
      statusCode: 500,
      description: "Lỗi máy chủ khi đăng nhập",
      level: "error",
    });
    res.status(500).json({ message: "Đăng nhập thất bại!", error: err });
  }
};
