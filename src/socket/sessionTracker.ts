// src/socket/sessionTracker.ts
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { SessionModel } from "../models/Session"; // Import model của bạn
import * as cookie from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;

// Key: socket.id, Value: sessionId
const activeSessions = new Map<string, string>();

export const setupSessionTracking = (io: Server) => {
  console.log("📡 [SessionTracker] Socket.IO session tracking is active");
  console.log("cookie module:", cookie);
  io.on("connection", async (socket) => { // Thêm async
    try {
      // ✅ Luôn dùng optional chaining để tránh undefined crash
      const headers = socket.handshake?.headers;
      const rawCookie = headers?.cookie;

      if (!rawCookie) {
        console.warn("⚠️ Không có cookie trong handshake – từ chối kết nối");
        socket.disconnect(true);
        return;
      }

      // ✅ Parse an toàn
      const cookies = cookie.parse(rawCookie);
      const token = cookies.accessToken;
      console.log("Token:", token);

      if (!token) {
        console.warn("⚠️ Không tìm thấy accessToken trong cookie");
        socket.disconnect(true);
        return;
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as unknown as { id: string };
        const userId = decoded.id; // Đây là 'userId' (string)
        socket.data.userId = userId;

        console.log("[Socket] Connected user:", userId);

        // (Các hàm log ping/pong giữ nguyên)
        socket.conn.on("packet", (packet) => {
          if (packet.type === "ping") console.log("[Server] Ping received");
          if (packet.type === "pong") console.log("[Server] Pong received");
        });


        // --- SỬA 1: DỌN DẸP CÁC SESSION "ZOMBIE" CỦA USER NÀY ---
        try {
          await SessionModel.updateMany(
            // Dùng đúng tên trường: "userId"
            { userId: userId, logoutAt: null }, 
            {
              logoutAt: new Date(Date.now() - 1000), 
              duration: 0,
            }
          );
        } catch (cleanupErr) {
          console.error("[Session] Lỗi khi dọn dẹp session cũ:", cleanupErr);
        }
        // ----------------------------------------------------

        // Tạo session login mới
        const loginTime = new Date();
        try {
          const session = await SessionModel.create({
            // Dùng đúng tên trường: "userId" và "loginAt"
            userId: userId, 
            loginAt: loginTime, 
            logoutAt: null,
          });

          // Dùng socket.id làm key (giữ nguyên)
          activeSessions.set(socket.id, session._id.toString());
          console.log(
            `[Session] Mới cho ${userId} (Socket: ${socket.id}), Session: ${session._id}`
          );
        } catch (err) {
          console.error(" [Session] Failed to create session:", err);
        }

        // Xử lý disconnect
        socket.on("disconnect", async () => {
          console.log(`[Socket] Disconnected user ${userId} (Socket: ${socket.id})`);

          // Lấy session bằng socket.id (giữ nguyên)
          const sessionId = activeSessions.get(socket.id);
          if (!sessionId){
            console.warn(`No session found for socket ${socket.id}`);
            return;
          }
            

          try {
            const logoutTime = new Date();
            const session = await SessionModel.findById(sessionId);

            // Dùng đúng tên trường: "logoutAt" và "loginAt"
            if (session && !session.logoutAt) {
              session.logoutAt = logoutTime;
              session.duration = Math.floor(
                (logoutTime.getTime() - session.loginAt.getTime()) / 1000
              );
              await session.save();
              console.log(
                `[Session] Đã đóng ${sessionId} cho ${userId}, Duration: ${session.duration}s`
              );
            }
          } catch (err) {
            console.error("[Session] Error updating session:", err);
          }

          // Xóa session bằng socket.id (giữ nguyên)
          activeSessions.delete(socket.id);
        });
      } catch (err: any) {
        console.error("❌ [Socket] Invalid token:", err.message);
        socket.disconnect(true);
      }
    } catch (error) {
      console.error("[SessionTracker] Lỗi không mong đợi:", error);
      socket.disconnect(true);
    }
  }
);
};