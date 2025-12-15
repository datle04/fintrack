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

  // 1. Thử lấy từ Query (Dành cho Chatbot FE gửi lên)
  const queryUserId = socket.handshake.query.userId;
  if (queryUserId) {
     userId = Array.isArray(queryUserId) ? queryUserId[0] : queryUserId;
     console.log(`🔍 Auth via Query: ${userId}`);
  }

  // 2. Thử lấy từ Cookie (Dành cho Web Browser bảo mật)
  // Lưu ý: Cross-domain cookie trên Render thường bị chặn nếu không set SameSite: None; Secure
  if (!userId && socket.handshake.headers.cookie) {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      // Đảm bảo key cookie khớp với cái bạn set lúc login (accessToken hay token?)
      const token = cookies.accessToken || cookies.token; 

      if (token) {
        const decoded: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string);
        userId = decoded.id || decoded._id; 
        console.log(`🍪 Auth via Cookie: ${userId}`);
      }
    } catch (err) {
      console.log("❌ Token invalid:", (err as Error).message);
    }
  }

  // 3. Quyết định kết nối
  if (userId) {
    socket.join(userId); // Join room theo ID User
    console.log(`✅ User ${userId} joined room.`);

    socket.on("disconnect", (reason) => {
       // User thoát hoặc mất mạng
       // console.log(`User ${userId} disconnected: ${reason}`);
    });
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