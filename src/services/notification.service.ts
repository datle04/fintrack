// src/services/notification.service.ts
import Notification from "../models/Notification";
import { Types } from "mongoose";

/**
 * Hàm dùng chung để tạo thông báo và bắn socket
 */
export const createAndSendNotification = async (
  userId: string | Types.ObjectId,
  type: string,     // budget_warning, reminder, etc.
  message: string,
  link?: string     // Link để user bấm vào (optional)
) => {
  try {
    // 1. Lưu vào Database
    const newNotification = await Notification.create({
      user: userId,
      type,
      message,
      link,
      isRead: false
    });

    // 2. Bắn Socket Real-time (Nếu user đang online)
    // global.io đã được setup ở Bước 1
    if (global.io) {
      // ⚠️ SAI (Rất dễ dính lỗi này):
      // global.io.to(userId).emit(...) 
      // Nếu userId là ObjectId, socket.io có thể không tìm thấy phòng string tương ứng.

      // ✅ ĐÚNG (Ép kiểu tuyệt đối):
      const roomName = String(userId); 
      
      console.log(`🚀 Emitting to room type: ${typeof roomName}, value: ${roomName}`);
      
      global.io.to(roomName).emit("new_notification", newNotification);
    }

    return newNotification;
  } catch (error) {
    console.error("Lỗi khi tạo thông báo:", error);
    // Không throw error để tránh làm hỏng luồng chính (ví dụ: giao dịch vẫn thành công dù thông báo lỗi)
  }
};