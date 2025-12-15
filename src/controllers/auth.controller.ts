import { Request, Response } from 'express';
import User from '../models/User';
import bcrypt from 'bcrypt';
import jwt, {SignOptions} from 'jsonwebtoken';
import { logAction } from '../utils/logAction';
import { AuthRequest } from '../middlewares/requireAuth';
import { sendOTPEmail } from '../services/email.service';

const JWT_SECRET = process.env.JWT_SECRET!;

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!; // <-- Bạn cần thêm biến này vào .env

// Thời gian hết hạn (ví dụ)
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY!;
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY!;

export const register = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) {
      await logAction(req, {
        action: "register_failed",
        statusCode: 400,
        description: `Email đã tồn tại: ${email}`,
        level: "warning",
      });
        res.status(400).json({ message: "Email đã tồn tại" });
        return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    await logAction(req, {
      action: "register_success",
      statusCode: 201,
      description: `Đăng ký thành công: ${email}`,
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        currency: "VND",
        avatar: user.avatarUrl,
        role: user.role,
        dob: user.dob,
        phone: user.phone,
        address: user.address,
        isBanned: user.isBanned,
      },
    });
  } catch (err) {
    await logAction(req, {
      action: "register_error",
      statusCode: 500,
      description: "Lỗi máy chủ khi đăng ký",
      level: "error",
    });
    res.status(500).json({ message: "Đăng ký thất bại!", error: err });
  }
};

// Đăng nhập
// --- HÀM LOGIN ĐÃ CẬP NHẬT ---
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password){
    res.status(400).json({ message: 'Email và mật khẩu là bắt buộc' });
    return;
  }
   
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await logAction(req, {
        action: 'Login Attempt',
        statusCode: 401,
        description: `Sai email hoặc mật khẩu: ${email}`,
        level: 'warning'
      });
      res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
      return;
    }

    if (user.isBanned){
      res.status(403).json({ message: 'Tài khoản của bạn đã bị khóa.' });
      return;
    }
      

    // === Tạo access & refresh token ===
    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY } as SignOptions
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY } as SignOptions
    );

    // === Lưu refresh token vào DB ===
    user.refreshToken = refreshToken;
    await user.save();

    // === Gửi cookie HTTP-only ===
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 ngày
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 15 * 60 * 1000 // 15 phút
    });

    await logAction(req, {
      action: 'Login Success',
      statusCode: 200,
      description: `User ${user.email} đăng nhập thành công`
    });

    // === Trả thông tin user ===
    res.status(200).json({
      message: 'Đăng nhập thành công',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        dob: user.dob,
        phone: user.phone,
        address: user.address,
        avatarUrl: user.avatarUrl,
        currency: user.currency,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ Lỗi khi đăng nhập:', err);
    await logAction(req, {
      action: 'Login Error',
      statusCode: 500,
      description: 'Lỗi server khi đăng nhập',
      level: 'error'
    });
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// --- HÀM REFRESH TOKEN MỚI ---
export const refreshToken = async (req: Request, res: Response) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  if (!incomingRefreshToken){
    res.status(401).json({ message: 'Thiếu refresh token' });
    return;
  }


  try {
    const decoded = jwt.verify(incomingRefreshToken, REFRESH_TOKEN_SECRET!) as { id: string };
    console.log("Decoded token:", decoded);
    const user = await User.findById(decoded.id);

    if (!user || user.isBanned || user.refreshToken !== incomingRefreshToken){
      res.status(403).json({ message: 'Refresh token không hợp lệ hoặc đã bị thu hồi' });
      return;
    }
      

    // === Tạo token mới ===
    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY } as SignOptions
    );

    const newRefreshToken = jwt.sign(
      { id: user._id },
      REFRESH_TOKEN_SECRET!,
      { expiresIn: REFRESH_TOKEN_EXPIRY } as SignOptions
    );

    user.refreshToken = newRefreshToken;
    await user.save();

    // === Set lại cookie ===
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000
    });

    res.status(200).json({ message: 'Làm mới token thành công' });
  } catch (err) {
    console.error('❌ Lỗi khi làm mới token:', err);
    res.status(403).json({ message: 'Refresh token không hợp lệ hoặc hết hạn' });
  }
};

// 1️⃣ API 1: Yêu cầu đổi mật khẩu (Gửi OTP)
export const requestChangePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { oldPassword } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId).select("+password +email");
    if (!user){
      res.status(404).json({ message: "User không tồn tại" });
      return;
    } 

    // Kiểm tra pass cũ
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch){
      res.status(400).json({ message: "Mật khẩu cũ không đúng" });
      return; 
    } 

    // Sinh OTP 6 số ngẫu nhiên
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Mã hóa OTP trước khi lưu DB (Bảo mật cao)
    const salt = await bcrypt.genSalt(10);
    const hashedOTP = await bcrypt.hash(otp, salt);

    // Lưu OTP vào DB (Hết hạn sau 5 phút)
    user.otp = hashedOTP;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); 
    await user.save();

    // Gửi Email
    await sendOTPEmail(user.email, otp);

    res.json({ message: "Mã OTP đã được gửi đến email của bạn. Vui lòng kiểm tra." });

  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// 2️⃣ API 2: Xác nhận OTP và Đổi mật khẩu
export const verifyAndChangePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { otp, newPassword } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId).select("+otp +otpExpires");
    if (!user){
      res.status(404).json({ message: "User không tồn tại" });
      return;
    }  

    // Kiểm tra thời hạn OTP
    if (!user.otpExpires || user.otpExpires < new Date()) {
      res.status(400).json({ message: "Mã OTP đã hết hạn. Vui lòng thử lại." });
      return;
    }

    // Kiểm tra mã OTP
    const isOtpMatch = await bcrypt.compare(otp, user.otp || "");
    if (!isOtpMatch) {
      res.status(400).json({ message: "Mã OTP không chính xác" });
      return;
    }

    // --- Đổi mật khẩu ---
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Xóa OTP sau khi dùng xong
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    await logAction(req, {
      action: "Change Password (2FA)",
      statusCode: 200,
      description: "Đổi mật khẩu thành công qua xác thực 2 bước"
    });

    res.json({ message: "Đổi mật khẩu thành công!" });

  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// 1️⃣ API 1: Yêu cầu lấy lại mật khẩu
// Route: POST /api/auth/forgot-password
// Body: { email: "user@gmail.com" }
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // 1. Tìm user theo Email (Vì chưa đăng nhập nên không có req.userId)
    const user = await User.findOne({ email });
    
    // ⚠️ BẢO MẬT: Để tránh hacker dò email (Enumeration Attack)
    // Dù tìm thấy hay không, vẫn nên trả về 1 thông báo chung chung.
    // Tuy nhiên, với đồ án, bạn có thể return 404 để dễ debug.
    if (!user) {
      res.status(404).json({ message: "Email này chưa được đăng ký." });
      return;
    }

    // 2. Sinh OTP và Mã hóa (Giống hệt phần đổi mật khẩu)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = await bcrypt.genSalt(10);
    const hashedOTP = await bcrypt.hash(otp, salt);

    // 3. Lưu OTP vào DB
    user.otp = hashedOTP;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 phút
    await user.save();

    // 4. Gửi Email (Dùng lại service cũ)
    await sendOTPEmail(email, otp);

    res.json({ message: "Mã xác thực đã được gửi vào email của bạn." });

  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// 2️⃣ API 2: Đặt lại mật khẩu mới
// Route: POST /api/auth/reset-password
// Body: { email: "...", otp: "...", newPassword: "..." }
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword } = req.body;

    // 1. Tìm user theo Email kèm các trường ẩn
    const user = await User.findOne({ email }).select("+otp +otpExpires");
    if (!user) {
        res.status(404).json({ message: "Người dùng không tồn tại" });
        return;
    }

    // 2. Kiểm tra hạn OTP
    if (!user.otpExpires || user.otpExpires < new Date()) {
      res.status(400).json({ message: "Mã OTP đã hết hạn." });
      return;
    }

    // 3. Kiểm tra mã OTP
    const isMatch = await bcrypt.compare(otp, user.otp || "");
    if (!isMatch) {
      res.status(400).json({ message: "Mã OTP không chính xác." });
      return;
    }

    // 4. Hash mật khẩu MỚI
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // 5. Dọn dẹp OTP
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập ngay." });

  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// --- HÀM LOGOUT MỚI ---
export const logout = async (req: Request, res: Response) => {
  // Lấy refresh token từ body (để biết user nào logout)
  const { refreshToken } = req.body;

  // Xóa cookie accessToken bất kể có refresh token hay không
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    // path: '/' // Đảm bảo path khớp với lúc set cookie
  });

  if (!refreshToken) {
    // Nếu không có refresh token, chỉ xóa cookie là đủ
    res.status(200).json({ message: 'Đã đăng xuất (chỉ xóa cookie)' });
    return;
  }

  try {
    // Tìm user dựa trên refresh token và xóa nó khỏi DB
    const user = await User.findOneAndUpdate(
      { refreshToken: refreshToken }, // Tìm user có token này
      { $unset: { refreshToken: "" } } // Xóa trường refreshToken
    );

    if (user) {
      console.log(`[Auth] Đã xóa refresh token cho user ${user.email} khi đăng xuất`);
      await logAction(req, { // Log hành động logout
          action: 'Logout Success',
          statusCode: 200,
          description: `User ${user.email} đăng xuất thành công`,
      });
    } else {
       console.warn(`[Auth] Logout: Không tìm thấy user với refresh token được cung cấp.`);
        await logAction(req, {
            action: 'Logout Attempt',
            statusCode: 400,
            description: 'Logout với refresh token không tồn tại trong DB',
            level: 'warning'
        });
    }

    res.status(200).json({ message: 'Đăng xuất thành công' });

  } catch (err) {
    console.error('❌ Lỗi khi đăng xuất:', err);
     await logAction(req, {
        action: 'Logout Error',
        statusCode: 500,
        description: 'Lỗi server khi xử lý logout',
        level: 'error'
    });
    // Vẫn trả về thành công vì cookie đã bị xóa
    res.status(200).json({ message: 'Đăng xuất thành công (có lỗi khi xóa token DB)' });
  }
};
// --- KẾT THÚC HÀM LOGOUT ---