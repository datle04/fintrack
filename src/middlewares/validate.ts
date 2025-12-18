import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { StatusCodes } from 'http-status-codes';

const validate = (schema: Joi.ObjectSchema, property: 'body' | 'params' | 'query' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[property]; 
    
    const { error } = schema.validate(data, { abortEarly: false });

    if (error) {
        const errorMessages = error.details.map((detail) => detail.message).join(', ');
      
        console.warn(`[Validation Error]: ${errorMessages}`);

        res.status(StatusCodes.BAD_REQUEST).json({
            error: 'Dữ liệu đầu vào không hợp lệ',
            details: errorMessages
        });
      return;
    }

    next();
  };
};

export default validate;