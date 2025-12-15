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
  // console.log(`🔍 [Middleware] Incoming connection: ${socket.id}`); // Log này ồn, có thể bỏ

  let userId: string | null = null;
  let authSource = "Unknown";

  // 1. Check Query (Ưu tiên 1)
  const queryUserId = socket.handshake.query.userId;
  if (queryUserId) {
     userId = Array.isArray(queryUserId) ? queryUserId[0] : queryUserId;
     authSource = "Query Param";
  }

  // 2. Check Cookie (Ưu tiên 2 - Nếu chưa có userId)
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
      // Token lỗi thì thôi, không cần log ầm ĩ nếu lát nữa reject
    }
  }

  // 3. QUYẾT ĐỊNH CUỐI CÙNG (Chỉ log 1 lần kết quả)
  if (userId) {
    socket.join(userId);
    // Chỉ in log xanh khi thành công
    console.log(`🔌 Socket ${socket.id} connected via [${authSource}] | User: ${userId}`);
    
    // ... setup listeners khác
  } else {
    // Chỉ in log đỏ khi thất bại toàn tập
    console.log(`⛔ Socket ${socket.id} REJECTED: No credentials (Cookie missing & No Query)`);
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