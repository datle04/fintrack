import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { SessionModel } from "../models/Session";
import * as cookie from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;

const activeSessions = new Map<string, string>();

export const setupSessionTracking = (io: Server) => {
  console.log("📡 [SessionTracker] Socket.IO session tracking is active");

  io.on("connection", async (socket) => {
    try {
      let userId: string | null = null;

      if (socket.handshake.auth && socket.handshake.auth.userId) {
        userId = socket.handshake.auth.userId;
        console.log(`🔑 [SessionTracker] Auth via Auth Object: ${userId}`);
      }

      else if (socket.handshake.headers.cookie) {
        try {
          const cookies = cookie.parse(socket.handshake.headers.cookie);
          const token = cookies.accessToken;
          
          if (token) {
            const decoded = jwt.verify(token, JWT_SECRET) as unknown as { id: string };
            userId = decoded.id;
            console.log(`🍪 [SessionTracker] Auth via Cookie: ${userId}`);
          }
        } catch (err) {
          console.warn("⚠️ [SessionTracker] Cookie token invalid:", err);
        }
      }

      if (!userId) {
        console.warn(`⛔ [SessionTracker] Rejected socket ${socket.id}: No UserID found in Auth or Cookie`);
        socket.disconnect(true);
        return;
      }

      socket.data.userId = userId;

      socket.conn.on("packet", (packet) => {
        if (packet.type === "ping") console.log("[Server] Ping received");
        if (packet.type === "pong") console.log("[Server] Pong received");
      });

      try {
        await SessionModel.updateMany(
          { userId: userId, logoutAt: null },
          {
            logoutAt: new Date(Date.now() - 1000),
            duration: 0,
          }
        );
      } catch (cleanupErr) {
        console.error("[Session] Lỗi khi dọn dẹp session cũ:", cleanupErr);
      }

      const loginTime = new Date();
      try {
        const session = await SessionModel.create({
          userId: userId,
          loginAt: loginTime,
          logoutAt: null,
        });

        activeSessions.set(socket.id, session._id.toString());
        console.log(
          `✅ [Session] Created for ${userId} (Socket: ${socket.id})`
        );
      } catch (err) {
        console.error("❌ [Session] Failed to create session:", err);
      }

      socket.on("disconnect", async () => {
        console.log(`[Socket] Disconnected user ${userId} (Socket: ${socket.id})`);

        const sessionId = activeSessions.get(socket.id);
        if (!sessionId) return;

        try {
          const logoutTime = new Date();
          const session = await SessionModel.findById(sessionId);

          if (session && !session.logoutAt) {
            session.logoutAt = logoutTime;
            session.duration = Math.floor(
              (logoutTime.getTime() - session.loginAt.getTime()) / 1000
            );
            await session.save();
            console.log(
              `💾 [Session] Closed ${sessionId}, Duration: ${session.duration}s`
            );
          }
        } catch (err) {
          console.error("[Session] Error updating session:", err);
        }

        activeSessions.delete(socket.id);
      });

    } catch (error) {
      console.error("[SessionTracker] Unexpected error:", error);
      socket.disconnect(true);
    }
  });
};