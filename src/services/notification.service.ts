import Notification from "../models/Notification";
import { Types } from "mongoose";

/**
 * Hàm dùng chung để tạo thông báo và bắn socket
 */
export const createAndSendNotification = async (
  userId: string | Types.ObjectId,
  type: string,     
  message: string,
  link?: string     
) => {
  try {
    const newNotification = await Notification.create({
      user: userId,
      type,
      message,
      link,
      isRead: false
    });

    if (global.io) {
      const roomName = String(userId); 
      
      console.log(`🚀 Emitting to room type: ${typeof roomName}, value: ${roomName}`);
      
      global.io.to(roomName).emit("new_notification", newNotification);
    }

    return newNotification;
  } catch (error) {
    console.error("Lỗi khi tạo thông báo:", error);
  }
};