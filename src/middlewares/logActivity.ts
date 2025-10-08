import { Request, Response, NextFunction } from "express";
import Log from "../models/Log";

export const logActivity = async (
  req: Request & { skipLogActivity?: boolean },
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();

  res.on("finish", async () => {
    try {
      // Nếu đã ghi log chi tiết bằng logAction thì bỏ qua
      if (req.skipLogActivity) return;

      const userId = (req as any).user?._id?.toString();
      const action = getActionName(req);

      await Log.create({
        userId: userId || undefined,
        action,
        method: req.method,
        endpoint: req.originalUrl,
        statusCode: res.statusCode,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("Error logging activity:", error);
    }
  });

  next();
};

const getActionName = (req: Request): string => {
  const method = req.method;
  const url = req.originalUrl;

  if (method === "GET") return `Viewed ${url}`;
  if (method === "POST") return `Created ${url}`;
  if (method === "PUT") return `Updated ${url}`;
  if (method === "PATCH") return `Patched ${url}`;
  if (method === "DELETE") return `Deleted ${url}`;
  return `Accessed ${url}`;
};
