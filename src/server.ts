import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config(); 
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
  process.env.FRONTEND_URL,      
  "http://localhost:5173",       
  "https://fintrack-frontend-pg3r.onrender.com"
].filter(Boolean) as string[];  

// Khởi tạo Socket.io
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'], 
  pingInterval: 25000, 
  pingTimeout: 20000, 
});

global.io = io; 

io.engine.on("connection_error", (err) => {
  console.log("🔥 [Engine Error]:", err.req?.url);
  console.log("   Code:", err.code);     
  console.log("   Msg:", err.message);   
  console.log("   Context:", err.context);
});

io.use((socket, next) => {
  console.log(`🔍 [Middleware] Incoming connection: ${socket.id}`);
  console.log("   Query:", socket.handshake.query);
  console.log("   Auth Header:", socket.handshake.headers.authorization);
  console.log("   Cookie:", socket.handshake.headers.cookie ? "✅ Có cookie" : "❌ Không cookie");
  next(); 
});

io.on("connection", (socket) => {
  let userId = null;
  let authSource = "";

  console.log(`🔍 [Handshake] ID: ${socket.id} | Transport: ${socket.conn.transport.name}`);

  if (socket.handshake.auth && socket.handshake.auth.userId) {
    userId = socket.handshake.auth.userId;
    authSource = "Auth Object";
  } 
  else if (socket.handshake.query && socket.handshake.query.userId) {
    userId = socket.handshake.query.userId;
    authSource = "Query Param";
  }

  if (userId) {
    socket.join(userId);
    console.log(`✅ Socket ${socket.id} ACCEPTED via [${authSource}] | User: ${userId}`);

    socket.join(userId);

    setTimeout(() => {
        console.log(`🧪 Test sending event to room ${userId}`);
        io.to(userId).emit("test_event", { message: "Hello from Server!" });
    }, 5000);

    socket.emit("connection_success", { status: "ok", userId });

  } else {
    console.error(`⛔ Socket ${socket.id} REJECTED. Auth:`, socket.handshake.auth, "Query:", socket.handshake.query);
    socket.disconnect(); 
  }
});

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