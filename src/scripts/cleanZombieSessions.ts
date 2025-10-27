import mongoose from "mongoose";
import { SessionModel } from "../models/Session"; // Đảm bảo đường dẫn đúng
import dotenv from "dotenv";

dotenv.config();

const cleanZombieSessions = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI không được định nghĩa trong .env");
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Đã kết nối CSDL...");

    // Xóa tất cả các session đang có logoutAt: null
    const result = await SessionModel.deleteMany({
      logoutAt: null, 
    });

    console.log(`✅ Đã dọn dẹp ${result.deletedCount} phiên "ma".`);

    await mongoose.disconnect();
    console.log("❌ Đã ngắt kết nối CSDL.");
  } catch (error) {
    console.error("Lỗi khi dọn dẹp phiên:", error);
    process.exit(1);
  }
};

cleanZombieSessions();