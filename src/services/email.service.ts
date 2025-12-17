// import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   host: 'smtp.gmail.com',
//   port: 587, // 👈 Hãy thử đổi thành 587
//   secure: false, // 👈 Đi kèm với port 587 là secure false (dùng STARTTLS)
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// export const sendOTPEmail = async (email: string, otp: string) => {
//   try {
//     const mailOptions = {
//       from: `"FinTrack Security" <${process.env.MAIL_USER}>`,
//       to: email,
//       subject: "Mã xác thực đổi mật khẩu - FinTrack",
//       html: `
//         <div style="font-family: Arial, sans-serif; padding: 20px;">
//           <h2>Xin chào,</h2>
//           <p>Bạn đang thực hiện yêu cầu đổi mật khẩu cho tài khoản FinTrack.</p>
//           <p>Mã xác thực (OTP) của bạn là:</p>
//           <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
//           <p>Mã này sẽ hết hạn trong vòng <strong>5 phút</strong>.</p>
//           <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
//         </div>
//       `,
//     };

//     await transporter.sendMail(mailOptions);
//     console.log(`📧 Đã gửi OTP đến ${email}`);
//     return true;
//   } catch (error) {
//     console.error("❌ Lỗi gửi email:", error);
//     return false;
//   }
// };

import { Resend } from 'resend';

// 1. Khởi tạo Resend Client
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    // 2. Gọi API gửi mail
    const { data, error } = await resend.emails.send({
      // ⚠️ QUAN TRỌNG: 
      // - Nếu chưa verify domain: Bắt buộc dùng 'onboarding@resend.dev'
      // - Nếu đã verify domain: Dùng 'security@your-domain.com'
      from: 'FinTrack Security <onboarding@resend.dev>', 
      
      to: [email], // Resend nhận mảng danh sách người nhận
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
    });

    // 3. Kiểm tra lỗi từ phía Resend trả về
    if (error) {
      console.error("❌ Resend API Error:", error);
      return false;
    }

    console.log(`📧 Đã gửi OTP thành công qua Resend. ID: ${data?.id}`);
    return true;

  } catch (error) {
    console.error("❌ Lỗi hệ thống khi gửi email:", error);
    return false;
  }
};