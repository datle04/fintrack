import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false, 
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS, 
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Hàm tiện ích để gửi email
 */
export const sendEmail = async (options: EmailOptions) => {
  try {
    const mailOptions = {
      from: `"FinTrack App" <${process.env.EMAIL_USER}>`, 
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Đã gửi email tới ${options.to}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Lỗi khi gửi email:', error);
    return false;
  }
};