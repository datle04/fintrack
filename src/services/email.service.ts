import nodemailer from "nodemailer";

// Cấu hình transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // 'smtp-relay.brevo.com'
  port: parseInt(process.env.EMAIL_PORT || "587"), // Thử 587 trước, nếu lỗi thì đổi thành 2525
  secure: false, // false cho 587 hoặc 2525
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Thêm dòng này để log chi tiết lỗi nếu có
  logger: true,
  debug: true, 
});

export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const mailOptions = {
      from: `"FinTrack Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Mã xác thực đổi mật khẩu - FinTrack",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Xin chào,</h2>
          <p>Bạn đang thực hiện yêu cầu đổi mật khẩu cho tài khoản FinTrack.</p>
          <p>Mã xác thực (OTP) của bạn là:</p>
          <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
          <p>Mã này sẽ hết hạn trong vòng <strong>5 phút</strong>.</p>
          <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`📧 Đã gửi OTP đến ${email} qua Brevo`);
    return true;
  } catch (error) {
    console.error("❌ Lỗi gửi email:", error);
    return false;
  }
};