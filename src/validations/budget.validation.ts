import Joi from 'joi';

// Luật validation cho 1 item trong mảng categories (Tách ra để tái sử dụng)
const categoryItemSchema = Joi.object({
  category: Joi.string().required(),
  originalAmount: Joi.number().min(0).required(),
});

// Schema Tạo mới
export const createBudgetSchema = Joi.object({
  month: Joi.number().min(1).max(12).required(),
  year: Joi.number().min(2020).max(2100).required(),
  originalAmount: Joi.number().min(0).required(),
  originalCurrency: Joi.string().required().default('VND'),
  categories: Joi.array().items(categoryItemSchema).unique('category').required(),
});

// Schema Cập nhật
export const updateBudgetSchema = Joi.object({
  month: Joi.number().min(1).max(12),
  year: Joi.number().min(2020).max(2100),
  
  // Cho phép sửa tổng tiền ngân sách
  originalAmount: Joi.number().min(0),
  originalCurrency: Joi.string(),

  // Nếu muốn sửa danh mục con, phải gửi lại cả mảng (để đảm bảo tính đồng bộ)
  categories: Joi.array().items(categoryItemSchema).unique('category'),
}).min(1);