// server.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import { Server } from 'socket.io';
import cookie from "cookie";
import jwt from "jsonwebtoken"
import app from './app';
import { setupSessionTracking } from './socket/sessionTracker';
import { initRecurringTransactionJob } from './cron/recurringJob';
import { initCheckBudgetAlert } from './cron/checkBudgetAlert';
import { startCleanupReportsJob } from './cron/cleanupReportsJob';


const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Khởi tạo server từ app
const server = http.createServer(app);

// Khởi tạo socket.io
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
  pingInterval: 60000, 
  pingTimeout: 300000, 
});

// --- QUAN TRỌNG: Gán vào global ---
global.io = io; 

// Cấu hình connection
io.on("connection", (socket) => {
  console.log(`🔌 New socket attempt: ${socket.id}`);

  let userId: string | null = null;

  // --- CÁCH 1: Lấy UserID từ Query (Cách bạn đang dùng ở Frontend) ---
  // Frontend: query: { userId: user._id }
  if (socket.handshake.query.userId) {
    userId = socket.handshake.query.userId as string;
    console.log(`🔍 Auth via Query Param: ${userId}`);
  }

  // --- CÁCH 2: Lấy UserID từ Cookie (Bảo mật hơn - Ưu tiên cách này) ---
  // Nếu query không có, thử đọc Cookie
  if (!userId && socket.handshake.headers.cookie) {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      const accessToken = cookies.accessToken; // Tên cookie bạn đã set lúc login

      if (accessToken) {
        const decoded: any = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET as string);
        userId = decoded.id; // Hoặc decoded._id tùy vào payload bạn sign
        console.log(`🍪 Auth via Cookie: ${userId}`);
      }
    } catch (err) {
      console.log("❌ Cookie token invalid:", err);
    }
  }

  // --- QUYẾT ĐỊNH CHO VÀO HAY ĐÁ RA ---
  if (userId) {
    // 1. Join Room
    socket.join(userId);
    console.log(`✅ User ${userId} joined room successfully.`);

    // 2. Xử lý các sự kiện khác
    socket.on("session.start", () => {
        console.log(`Session started for ${userId}`);
    });
    
    socket.on("disconnect", () => {
        console.log(`❌ User ${userId} disconnected`);
    });

  } else {
    // Nếu không tìm thấy UserID (cả Query và Cookie đều fail)
    console.log("⛔ Connection REJECTED: No UserID found.");
    socket.disconnect(); // <--- ĐÂY LÀ LÝ DO BẠN BỊ "io server disconnect"
  }
});

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server is running...`);
});
// Thiết lập theo dõi phiên người dùng
setupSessionTracking(io);

// Cron jobs
initRecurringTransactionJob();
initCheckBudgetAlert();
startCleanupReportsJob();

// MongoDB connect & start server
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("✅ Connected to MongoDB");

    server.listen(PORT, () => {
      console.log(`🚀 Server is running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
  }
};

startServer();
