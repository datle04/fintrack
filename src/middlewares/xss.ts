import { Request, Response, NextFunction } from "express";
import xss from "xss";

const sanitize = (data: any): any => {
  if (!data) return data;

  if (typeof data === "string") {
    return xss(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item));
  }

  if (typeof data === "object") {
    const cleanedData: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        cleanedData[key] = sanitize(data[key]);
      }
    }
    return cleanedData;
  }
  
  return data;
};

export const xssMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
};