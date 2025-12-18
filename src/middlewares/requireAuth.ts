import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import UserModel, { IUser } from '../models/User'; // 
import User from '../models/User';

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET!;

export interface AuthRequest extends Request {
  userId?: string;
  user?: IUser;
  userRole?: string;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  let token;
  
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    res.status(401).json({ message: 'Yêu cầu xác thực (Không có token)' });
    return;
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      id: string;
      role: string;
    };

    const user = await User.findById(decoded.id);
    if (!user || user.isBanned) {
      res.clearCookie('accessToken'); 
      res
        .status(401)
        .json({ message: 'Token không hợp lệ hoặc tài khoản bị khóa' });
      return;
    }

    req.userId = decoded.id;
    req.userRole = decoded.role;
    req.user = user;

    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    res.clearCookie('accessToken');
    res
      .status(401)
      .json({ message: 'Yêu cầu xác thực (Token không hợp lệ/hết hạn)' });
    return;
  }
};