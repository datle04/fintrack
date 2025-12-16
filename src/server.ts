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
  "http://localhost:5173",       // Dev: Vite default     // Dev: React 
  "https://fintrack-frontend-pg3r.onrender.com"
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
  let userId = null;
  let authSource = "";

  console.log(`🔍 [Handshake] ID: ${socket.id} | Transport: ${socket.conn.transport.name}`);

  // CÁCH 1: Lấy từ Auth Object (Chuẩn mới - Ưu tiên)
  if (socket.handshake.auth && socket.handshake.auth.userId) {
    userId = socket.handshake.auth.userId;
    authSource = "Auth Object";
  } 
  // CÁCH 2: Fallback lấy từ Query (Cho code cũ nếu còn sót)
  else if (socket.handshake.query && socket.handshake.query.userId) {
    userId = socket.handshake.query.userId;
    authSource = "Query Param";
  }

  // --- LOGIC KIỂM TRA ---
  if (userId) {
    // ✅ THÀNH CÔNG
    socket.join(userId);
    console.log(`✅ Socket ${socket.id} ACCEPTED via [${authSource}] | User: ${userId}`);

    // Server.js - Thêm vào sau khi socket.join(userId)
    socket.join(userId);

    // TEST: Tự bắn tin nhắn cho chính mình sau 5 giây
    setTimeout(() => {
        console.log(`🧪 Test sending event to room ${userId}`);
        io.to(userId).emit("test_event", { message: "Hello from Server!" });
    }, 5000);
    
    // Gửi tín hiệu báo cho client biết đã connect thành công về mặt logic
    socket.emit("connection_success", { status: "ok", userId });

  } else {
    // ❌ THẤT BẠI
    console.error(`⛔ Socket ${socket.id} REJECTED. Auth:`, socket.handshake.auth, "Query:", socket.handshake.query);
    
    // Ngắt kết nối
    socket.disconnect(); 
  }

  // ... Các sự kiện on khác ...
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