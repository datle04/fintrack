import Joi from 'joi';
import { objectId } from './custom.validation';

// 1. Schema Tạo mới (Giữ nguyên cái cũ của bạn)
export const createTransactionSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required(),
  amount: Joi.number().greater(0).required(),
  category: Joi.string().required(),
  currency: Joi.string().required().default('VND'),
  // exchangeRate: Joi.number().min(0).default(1),
  note: Joi.string().allow('').max(500),
  date: Joi.date().iso().max('now'),
  receiptImage: Joi.array().items(Joi.string().uri()),
  isRecurring: Joi.boolean().default(false),
  recurringDay: Joi.number().min(1).max(31).when('isRecurring', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  goalId: Joi.string().custom(objectId).allow(null),
});

// 2. Schema Cập nhật (Update) - Tự động tạo từ Create
export const updateTransactionSchema = createTransactionSchema
  // Liệt kê tất cả các key bạn cho phép sửa
  .fork(
    [
      'type', 'amount', 'category', 'currency', 'exchangeRate', 
      'note', 'date', 'receiptImage', 'isRecurring', 'recurringDay', 'goalId'
    ],
    (schema) => schema.optional() // Biến tất cả thành optional
  )
  .min(1); // Chặn gửi body rỗng: {}