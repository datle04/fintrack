import Log from "../models/Log";
import { Request } from "express";

type LogRequest = Request & {
  skipLogActivity?: boolean;
  user?: { _id: { toString: () => string } };
};

export const logAction = async (
  req: LogRequest | null,
  params: {
    action: string;
    statusCode: number;
    description?: string;
    level?: "info" | "warning" | "error" | "critical";
    
    // 👇 THÊM DÒNG NÀY: Tham số tùy chọn
    metadata?: any; 
  }
) => {
  try {
    if (req) {
      req.skipLogActivity = true;
    }

    const userId = (req as any)?.user?._id?.toString();

    await Log.create({
      userId: userId || undefined,
      action: params.action,
      method: req?.method || "SYSTEM",
      endpoint: req?.originalUrl || "/system",
      statusCode: params.statusCode,
      description: params.description || "",
      level: params.level || "info",
      timestamp: new Date(),
      
      // 👇 THÊM DÒNG NÀY: Lưu metadata vào DB
      metadata: params.metadata 
    });
  } catch (error) {
    console.error("❌ Error logging action:", error);
  }
};