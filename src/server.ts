// server.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config(); // Load env trước tiên
import http from 'http';
import { Server } from 'socket.io';
import cookie from "cookie";
import jwt from "jsonwebtoken";
import app from './app';
import { setupSessionTracking } from './socket/sessionTracker';
import { initRecurringTransactionJob } from './cron/recurringJob';
import { initCheckBudgetAlert } from './cron/checkBudgetAlert';
import { startCleanupReportsJob } from './cron/cleanupReportsJob';
import startGoalScanner from './cron/checkGoalStatus';

const PORT = process.env.PORT || 5000;

// Khởi tạo server
const server = http.createServer(app);

// Cấu hình CORS cho Socket
const allowedOrigins = [
  process.env.FRONTEND_URL,      // Prod: https://my-app.onrender.com
  "http://localhost:5173",       // Dev: Vite default     // Dev: React default
].filter(Boolean) as string[];   // Lọc bỏ undefined nếu chưa set env

// Khởi tạo Socket.io
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'], // Ưu tiên websocket
  pingInterval: 25000, // Gửi ping mỗi 25s (Render timeout thường là 60s, nên set thấp hơn)
  pingTimeout: 20000,  // Chờ pong 20s
});

// Gán Global (Lưu ý: cần file type definition hoặc ép kiểu as any)
global.io = io; 

io.on("connection", (socket) => {
  console.log(`🔌 New socket attempt: ${socket.id}`);

  let userId: string | null = null;

  // 1. ƯU TIÊN: Lấy từ Query (Cái này đang chạy tốt)
  const queryUserId = socket.handshake.query.userId;
  if (queryUserId) {
     userId = Array.isArray(queryUserId) ? queryUserId[0] : queryUserId;
     console.log(`🔍 Auth via Query: ${userId}`);
  }

  // 2. THỬ TIẾP: Lấy từ Cookie (Nếu Query không có hoặc muốn check thêm)
  if (!userId && socket.handshake.headers.cookie) {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      const token = cookies.accessToken;
      if (token) {
        const decoded: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string);
        userId = decoded.id; 
        console.log(`🍪 Auth via Cookie: ${userId}`);
      }
    } catch (err) {
      console.log("❌ Cookie Error:", (err as Error).message);
    }
  } else if (!userId) {
     // Chỉ log warning nếu chưa có userId VÀ không có cookie header
     console.log("⚠️ Handshake missing cookie header & query param");
  }

  // 3. QUYẾT ĐỊNH CUỐI CÙNG
  if (userId) {
    socket.join(userId);
    console.log(`✅ User ${userId} joined room.`);
  } else {
    // Nếu không xác thực được -> Từ chối
    console.log(`⛔ Rejecting socket ${socket.id}: No Auth.`);
    socket.disconnect(); 
  }
});

// Setup modules khác
setupSessionTracking(io);
initRecurringTransactionJob();
initCheckBudgetAlert();
startCleanupReportsJob();
startGoalScanner();

// Start Server
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("✅ MongoDB Connected");
    
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Socket allowed origins:`, allowedOrigins);
    });
  } catch (err) {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  }
};

startServer();