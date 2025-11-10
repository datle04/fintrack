import Log from "../models/Log";
import { Request } from "express";

// Định nghĩa một kiểu (type) cho 'req' để code sạch hơn
type LogRequest = Request & {
  skipLogActivity?: boolean;
  user?: { _id: { toString: () => string } };
};

export const logAction = async (
  // --- SỬA 1: Cho phép 'req' là 'null' ---
  req: LogRequest | null,
  params: {
    action: string;
    statusCode: number;
    description?: string;
    level?: "info" | "warning" | "error" | "critical";
  }
) => {
  try {
    // --- SỬA 2: Thêm kiểm tra 'req' tồn tại ---
    if (req) {
      // Đánh dấu để middleware không log trùng
      req.skipLogActivity = true;
    }

    const userId = (req as any)?.user?._id?.toString();

    await Log.create({
      // --- SỬA 3: Đảm bảo các trường này có giá trị mặc định nếu 'req' là 'null' ---
      userId: userId || undefined,
      action: params.action,
      method: req?.method || "SYSTEM", // Mặc định là 'SYSTEM' nếu không có req
      endpoint: req?.originalUrl || "/system", // Mặc định là '/system'
      statusCode: params.statusCode,
      description: params.description || "",
      level: params.level || "info",
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("❌ Error logging action:", error);
  }
};