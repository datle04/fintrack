// server.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import { Server } from 'socket.io';

import app from './app';
import { setupSessionTracking } from './socket/sessionTracker';
import { initRecurringTransactionJob } from './cron/recurringJob';
import { initCheckBudgetAlert } from './cron/checkBudgetAlert';
import { startCleanupReportsJob } from './cron/cleanupReportsJob';


const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Khởi tạo server từ app
const server = http.createServer(app);

// Khởi tạo socket.io
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    // credentials: true,
  },
  pingInterval: 60000, 
  pingTimeout: 300000, 
});

// --- QUAN TRỌNG: Gán vào global ---
global.io = io; 

// Cấu hình connection
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId as string;
  console.log(`⚡ New connection: ${socket.id}`);
  if (userId) {
    socket.join(userId); // Cho user vào "phòng" riêng
    console.log(`✅ Socket ${socket.id} joined rooms:`, Array.from(socket.rooms));
  } else {
    console.log("⚠️ Connection REJECTED joining room (No userId in query)");
  }
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
