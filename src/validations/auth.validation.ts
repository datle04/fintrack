// src/validations/auth.validation.ts
import Joi from 'joi';

// Schema cho API Register
export const registerSchema = Joi.object({
  name: Joi.string().required().messages({'any.required': 'Tên là bắt buộc'}),
  email: Joi.string().email().required().messages({'string.email': 'Email không hợp lệ'}),
  password: Joi.string().min(6).required().messages({'string.min': 'Mật khẩu phải > 6 ký tự'}),
  
  // Các trường optional khi đăng ký
  phone: Joi.string().pattern(/^[0-9]+$/).min(10).optional(),
  address: Joi.string().allow('').optional(),
  currency: Joi.string().default('VND'),
});

// Schema cho API Login
export const loginSchema = Joi.object({
  email: Joi.string().required(),
  password: Joi.string().required(),
});

// Schema Update Profile
export const updateProfileSchema = Joi.object({
  name: Joi.string().min(2), // Tên ít nhất 2 ký tự
  avatarUrl: Joi.string().uri().allow(''), // Cho phép xóa avatar bằng chuỗi rỗng
  
  // Validate ngày sinh (YYYY-MM-DD) hoặc ISO string
  dob: Joi.string(), 
  
  phone: Joi.string().pattern(/^[0-9]+$/).min(10).max(15),
  address: Joi.string().allow('').max(200),
  
  currency: Joi.string().length(3).uppercase(), // VD: VND, USD
}).min(1);
