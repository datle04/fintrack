import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import UserModel, { IUser } from '../models/User'; // 

export interface AuthRequest extends Request {
  userId?: string;
  user?: IUser;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'Bạn chưa đăng nhập!' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
    req.userId = decoded.id;

    const user = await UserModel.findById(decoded.id).select('-password');

    if (!user) {
        res.status(401).json({ message: 'Người dùng không tồn tại.' });
        return;
    }

    req.user = user; // 

    next();
  } catch (error) {
      res.status(401).json({ message: 'Token không hợp lệ!' });
      return;
  }
};
