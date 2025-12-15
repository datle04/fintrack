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

// Thêm Middleware Log Global để bắt mọi request
io.engine.on("connection_error", (err) => {
  console.log("🔥 [Engine Error]:", err.req?.url);
  console.log("   Code:", err.code);     // Mã lỗi
  console.log("   Msg:", err.message);   // Lý do (vd: Bad handshake method)
  console.log("   Context:", err.context);
});

// Middleware log mọi request handshake
io.use((socket, next) => {
  console.log(`🔍 [Middleware] Incoming connection: ${socket.id}`);
  console.log("   Query:", socket.handshake.query);
  console.log("   Auth Header:", socket.handshake.headers.authorization);
  console.log("   Cookie:", socket.handshake.headers.cookie ? "✅ Có cookie" : "❌ Không cookie");
  next(); // Cho đi tiếp
});

io.on("connection", (socket) => {
  // Biến lưu kết quả xác thực
  let userId: string | null = null;
  let authSource = "";

  // ---------------------------------------------------------
  // BƯỚC 1: Kiểm tra Query Param (Ưu tiên 1 - Dành cho Chatbot/Fallback)
  // ---------------------------------------------------------
  const queryUserId = socket.handshake.query.userId;
  if (queryUserId) {
    userId = Array.isArray(queryUserId) ? queryUserId[0] : queryUserId;
    authSource = "Query Param";
  }

  // ---------------------------------------------------------
  // BƯỚC 2: Kiểm tra Cookie (Ưu tiên 2 - Chỉ chạy nếu BƯỚC 1 thất bại)
  // ---------------------------------------------------------
  if (!userId && socket.handshake.headers.cookie) {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      const token = cookies.accessToken;
      if (token) {
        const decoded: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string);
        userId = decoded.id; 
        authSource = "Cookie";
      }
    } catch (err) {
      console.log("⚠️ Token invalid:", (err as Error).message);
    }
  }

  // ---------------------------------------------------------
  // BƯỚC 3: QUYẾT ĐỊNH CUỐI CÙNG (Chỉ Disconnect ở đây)
  // ---------------------------------------------------------
  if (userId) {
    // ===> THÀNH CÔNG
    socket.join(userId);
    console.log(`✅ Socket ${socket.id} CONNECTED via [${authSource}] | User: ${userId}`);
    
    // Setup các sự kiện khác
    socket.on("disconnect", (reason) => {
       // console.log(`User ${userId} disconnected: ${reason}`);
    });

  } else {
    // ===> THẤT BẠI (Chỉ khi CẢ 2 bước trên đều không tìm thấy userId)
    console.log(`⛔ Socket ${socket.id} REJECTED: No credentials found.`);
    socket.disconnect(); // <--- Chỉ ngắt kết nối ở đây!
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