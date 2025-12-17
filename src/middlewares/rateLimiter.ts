import rateLimit from "express-rate-limit";

// 1. Limiter chung cho toàn bộ ứng dụng (Chống DDoS nhẹ)
// Cho phép 100 request trong 15 phút từ 1 IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, 
  message: {
    message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút."
  },
  standardHeaders: true, // Trả về thông tin RateLimit trong header
  legacyHeaders: false,
});

// 2. Limiter KHẮT KHE cho việc gửi OTP/Email (Quan trọng nhất)
// Chỉ cho phép gửi 3 email trong vòng 10 phút
export const emailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 phút
  max: 3, // Tối đa 3 lần
  message: {
    message: "Bạn đã yêu cầu gửi email quá nhiều lần. Vui lòng đợi 10 phút trước khi thử lại."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Limiter cho Đăng nhập (Chống dò mật khẩu)
// Cho phép sai 5 lần trong 5 phút
export const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: {
    message: "Đăng nhập thất bại quá nhiều lần. Vui lòng thử lại sau 5 phút."
  }
});