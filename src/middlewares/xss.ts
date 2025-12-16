// src/middleware/xss.ts
import { Request, Response, NextFunction } from "express";
import xss from "xss";

/**
 * Hàm đệ quy để sanitize dữ liệu (String, Object, Array)
 */
const sanitize = (data: any): any => {
  if (!data) return data;

  if (typeof data === "string") {
    // Làm sạch chuỗi bằng thư viện xss
    return xss(data);
  }

  if (Array.isArray(data)) {
    // Nếu là mảng, map qua từng phần tử để làm sạch
    return data.map((item) => sanitize(item));
  }

  if (typeof data === "object") {
    // Nếu là object, loop qua từng key để làm sạch value
    const cleanedData: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        cleanedData[key] = sanitize(data[key]);
      }
    }
    return cleanedData;
  }

  // Các kiểu dữ liệu khác (number, boolean...) giữ nguyên
  return data;
};

export const xssMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
};