import Joi from 'joi';
import { objectId } from './custom.validation';

export const createTransactionSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required(),
  amount: Joi.number().greater(0).required(),
  category: Joi.string().required(),
  currency: Joi.string().required().default('VND'),
  exchangeRate: Joi.number().min(0).default(1),
  note: Joi.string().allow('').max(500),
  date: Joi.date().iso(),
  receiptImages: Joi.any().strip(), 
  isRecurring: Joi.boolean().default(false),
  recurringDay: Joi.number().min(1).max(31).when('isRecurring', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  goalId: Joi.string().custom(objectId).allow(null),
});

export const updateTransactionSchema = createTransactionSchema
  .fork(
    [
      'type', 'amount', 'category', 'currency', 'exchangeRate', 
      'note', 'date', 'receiptImages', 'isRecurring', 'recurringDay', 'goalId'
    ],
    (schema) => schema.optional()
  )
  .keys({
    existingImages: Joi.alternatives().try(
      Joi.array().items(Joi.string()), 
      Joi.string()
    ),

    reason: Joi.string().allow('').optional(),

    receiptImages: Joi.any().strip(), 
  })
  .min(1);

export const adminUpdateTransactionSchema = updateTransactionSchema.keys({
  reason: Joi.string().required().min(5).messages({
    'any.required': 'Admin bắt buộc phải nhập lý do chỉnh sửa',
    'string.empty': 'Lý do không được để trống',
    'string.min': 'Lý do phải có ít nhất 5 ký tự'
  }),
});