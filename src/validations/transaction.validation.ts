import Joi from 'joi';
import { objectId } from './custom.validation';

// 1. Schema Tạo mới (Giữ nguyên cái cũ của bạn)
export const createTransactionSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required(),
  amount: Joi.number().greater(0).required(),
  category: Joi.string().required(),
  currency: Joi.string().required().default('VND'),
  exchangeRate: Joi.number().min(0).default(1),
  note: Joi.string().allow('').max(500),
  date: Joi.date().iso(),
  
  // 👇 SỬA DÒNG NÀY:
  // Thay vì bắt buộc là array string (URL), ta dùng .strip()
  // Lý do: Ảnh nằm trong req.files (Multer xử lý), Joi không cần quan tâm field này trong body.
  receiptImages: Joi.any().strip(), 

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
  .fork(
    [
      'type', 'amount', 'category', 'currency', 'exchangeRate', 
      'note', 'date', 'receiptImages', 'isRecurring', 'recurringDay', 'goalId'
    ],
    (schema) => schema.optional()
  )
  .keys({
    // 1. Cho phép gửi danh sách URL ảnh cũ (nếu có)
    existingImages: Joi.alternatives().try(
      Joi.array().items(Joi.string()), 
      Joi.string()
    ),

    reason: Joi.string().allow('').optional(),

    receiptImages: Joi.any().strip(), 
  })
  .min(1);