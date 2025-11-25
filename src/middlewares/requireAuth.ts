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

  // --- BẮT ĐẦU THAY ĐỔI ---

  // 1. Ưu tiên kiểm tra 'Authorization' header (cho chatbot service)

  console.log("--- DEBUG AUTH ---");
  console.log("Cookies nhận được:", req.cookies); 
  console.log("Headers Authorization:", req.headers.authorization);
  
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  // 2. Nếu không có header, kiểm tra cookie (cho frontend)
  else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  // 3. Nếu không có cả hai
  if (!token) {
    res.status(401).json({ message: 'Yêu cầu xác thực (Không có token)' });
    return;
  }
  // --- KẾT THÚC THAY ĐỔI ---

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      id: string;
      role: string;
    };

    // Kiểm tra xem user còn tồn tại không
    const user = await User.findById(decoded.id);
    if (!user || user.isBanned) {
      res.clearCookie('accessToken'); // Xóa cookie nếu user không hợp lệ
      res
        .status(401)
        .json({ message: 'Token không hợp lệ hoặc tài khoản bị khóa' });
      return;
    }

    // Gắn thông tin vào request
    req.userId = decoded.id;
    req.userRole = decoded.role;
    req.user = user;

    next(); // Chuyển tiếp request
  } catch (err) {
    console.error('Token verification failed:', err);
    res.clearCookie('accessToken');
    res
      .status(401)
      .json({ message: 'Yêu cầu xác thực (Token không hợp lệ/hết hạn)' });
    return;
  }
};