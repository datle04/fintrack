import Joi from 'joi';
import { objectId } from './custom.validation';

export const adminUpdateUserSchema = Joi.object({
  role: Joi.string().valid('user', 'admin').required(),
  reason: Joi.string().required().min(5),
  name: Joi.forbidden(),
  email: Joi.forbidden(),
  password: Joi.forbidden(),
  currency: Joi.forbidden(),
});