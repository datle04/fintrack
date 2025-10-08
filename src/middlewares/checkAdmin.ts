import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./requireAuth"; 

export const checkAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: "Chưa xác thực người dùng." });
    return;
  }

  if (user.role !== "admin") {
    res.status(403).json({ message: "Bạn không có quyền truy cập chức năng này." });
    return;
  }

  next();
};
