import Joi from 'joi';

const GOAL_STATUSES = ['in_progress', 'completed', 'failed'];

// Schema Tạo mới
export const createGoalSchema = Joi.object({
  name: Joi.string().required().trim(),
  targetOriginalAmount: Joi.number().min(1).required(),
  targetCurrency: Joi.string().required().default('VND'),
  targetDate: Joi.date().greater('now').required(),
  description: Joi.string().allow('').optional(),
  status: Joi.string().valid(...GOAL_STATUSES).default('in_progress'),
  isCompleted: Joi.boolean().default(false), 
});

// Schema Cập nhật
export const updateGoalSchema = Joi.object({
  name: Joi.string().trim(),
  targetOriginalAmount: Joi.number().min(1),
  targetCurrency: Joi.string(),
  targetDate: Joi.date().greater('now'),
  description: Joi.string().allow(''),
  status: Joi.string().valid(...GOAL_STATUSES),
  isCompleted: Joi.boolean() 
}).min(1);

export const adminUpdateGoalSchema = Joi.object({
  name: Joi.string().trim(),
  description: Joi.string().allow(''),
  reason: Joi.string().required().min(5).messages({
    'any.required': 'Admin bắt buộc phải nhập lý do chỉnh sửa',
    'string.empty': 'Lý do không được để trống',
    'string.min': 'Lý do quá ngắn (tối thiểu 5 ký tự)'
  }),
  targetOriginalAmount: Joi.forbidden(),
  targetDate: Joi.forbidden(),
  status: Joi.forbidden(),
  targetCurrency: Joi.forbidden(),
}).min(1);