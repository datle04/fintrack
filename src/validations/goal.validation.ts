import Joi from 'joi';

// Định nghĩa danh sách trạng thái hợp lệ (Khớp với Model)
const GOAL_STATUSES = ['in_progress', 'completed', 'failed'];

// Schema Tạo mới
export const createGoalSchema = Joi.object({
  name: Joi.string().required().trim(),
  targetOriginalAmount: Joi.number().min(1).required(),
  targetCurrency: Joi.string().required().default('VND'),
  targetDate: Joi.date().greater('now').required(),
  description: Joi.string().allow('').optional(),
  
  // 👇 THÊM: Cho phép set status ngay lúc tạo (tùy chọn)
  // Nếu không gửi, Mongoose sẽ tự default là 'in_progress'
  status: Joi.string().valid(...GOAL_STATUSES).default('in_progress'),
  
  // isCompleted lúc tạo thường là false, có thể bỏ qua hoặc validate false
  isCompleted: Joi.boolean().default(false), 
});

// Schema Cập nhật
export const updateGoalSchema = Joi.object({
  name: Joi.string().trim(),
  targetOriginalAmount: Joi.number().min(1),
  targetCurrency: Joi.string(),
  
  // Lưu ý: Logic greater('now') khi update có thể gây lỗi nếu user
  // chỉ muốn sửa status của một goal đã quá hạn (ngày trong quá khứ).
  // Tuy nhiên nếu Frontend chỉ gửi field thay đổi thì không sao.
  targetDate: Joi.date().greater('now'),
  
  description: Joi.string().allow(''),
  
  // 👇 THÊM: Validate status
  // Chỉ chấp nhận 1 trong 3 giá trị enum
  status: Joi.string().valid(...GOAL_STATUSES),

  // Vẫn giữ isCompleted để tương thích ngược nếu Frontend chưa sửa kịp
  // (Mongoose Hook sẽ lo việc đồng bộ nó với status)
  isCompleted: Joi.boolean() 
}).min(1);

export const adminUpdateGoalSchema = Joi.object({
  // 1. Chỉ cho phép sửa Metadata
  name: Joi.string().trim(),
  description: Joi.string().allow(''),

  // 2. Bắt buộc phải có lý do (Audit Log)
  reason: Joi.string().required().min(5).messages({
    'any.required': 'Admin bắt buộc phải nhập lý do chỉnh sửa',
    'string.empty': 'Lý do không được để trống',
    'string.min': 'Lý do quá ngắn (tối thiểu 5 ký tự)'
  }),

  // 3. (Tùy chọn) Chặn tuyệt đối các trường nhạy cảm nếu lỡ gửi lên
  // Joi mặc định sẽ cho qua các trường không khai báo nếu không bật 'stripUnknown',
  // nhưng để an toàn, ta có thể cấm tiệt:
  targetOriginalAmount: Joi.forbidden(),
  targetDate: Joi.forbidden(),
  status: Joi.forbidden(),
  targetCurrency: Joi.forbidden(),
}).min(1);