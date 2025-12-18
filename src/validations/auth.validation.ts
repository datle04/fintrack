import Joi from 'joi';

export const registerSchema = Joi.object({
  name: Joi.string().required().messages({'any.required': 'Tên là bắt buộc'}),
  email: Joi.string().email().required().messages({'string.email': 'Email không hợp lệ'}),
  password: Joi.string().min(6).required().messages({'string.min': 'Mật khẩu phải > 6 ký tự'}),
  phone: Joi.string().pattern(/^[0-9]+$/).min(10).optional(),
  address: Joi.string().allow('').optional(),
  currency: Joi.string().default('VND'),
});

export const loginSchema = Joi.object({
  email: Joi.string().required(),
  password: Joi.string().required(),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().min(2), 
  avatarUrl: Joi.string().uri().allow(''), 
  dob: Joi.string(), 
  phone: Joi.string().pattern(/^[0-9]+$/).min(10).max(15),
  address: Joi.string().allow('').max(200),
  currency: Joi.string().length(3).uppercase(), 
}).min(1);
