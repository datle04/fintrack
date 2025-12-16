import Joi from 'joi';

// Schema Tạo mới
export const createGoalSchema = Joi.object({
  name: Joi.string().required().trim(),
  targetOriginalAmount: Joi.number().min(1).required(),
  targetCurrency: Joi.string().required().default('VND'),
  targetDate: Joi.date().greater('now').required(),
  description: Joi.string().allow('').optional(),
});

// Schema Cập nhật
export const updateGoalSchema = Joi.object({
  // Copy lại các trường nhưng bỏ .required()
  name: Joi.string().trim(),
  targetOriginalAmount: Joi.number().min(1),
  targetCurrency: Joi.string(),
  targetDate: Joi.date().greater('now'),
  description: Joi.string().allow(''),
  
  // Thêm trường này (chỉ update mới có)
  isCompleted: Joi.boolean() 
}).min(1);