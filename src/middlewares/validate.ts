// src/middlewares/validate.ts
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { StatusCodes } from 'http-status-codes';

// Hàm này nhận vào một schema (bộ luật) và trả về một middleware
const validate = (schema: Joi.ObjectSchema, property: 'body' | 'params' | 'query' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Chọn đúng chỗ để check (mặc định là body)
    const data = req[property]; 
    
    const { error } = schema.validate(data, { abortEarly: false });

    if (error) {
        // 2. Nếu có lỗi, map ra danh sách message cho đẹp
        const errorMessages = error.details.map((detail) => detail.message).join(', ');
      
        console.warn(`⚠️ [Validation Error]: ${errorMessages}`);
      
        // 3. Trả về 400 Bad Request ngay lập tức
        res.status(StatusCodes.BAD_REQUEST).json({
            error: 'Dữ liệu đầu vào không hợp lệ',
            details: errorMessages
        });
      return;
    }

    // 4. Nếu ngon lành -> Cho đi tiếp vào Controller
    next();
  };
};

export default validate;