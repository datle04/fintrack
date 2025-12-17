import Joi from 'joi';
import { objectId } from './custom.validation';

export const adminUpdateUserSchema = Joi.object({
  // Chỉ cho phép role và reason
  role: Joi.string().valid('user', 'admin').required(),
  reason: Joi.string().required().min(5),

  // Cấm tiệt các trường khác (Optional - để strict hơn)
  name: Joi.forbidden(),
  email: Joi.forbidden(),
  password: Joi.forbidden(),
  currency: Joi.forbidden(),
  // ...
});