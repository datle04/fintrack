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
    credentials: true,
  },
  pingInterval: 10000, // mỗi 5 giây gửi 1 ping
  pingTimeout: 30000, // nếu 3 giây không có pong thì disconnect
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
