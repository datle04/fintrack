// scripts/setCurrencyForAllUsers.js
import mongoose from "mongoose";
import User from "../models/User.js"; // <-- CHÚ Ý: Cập nhật đường dẫn này!
import "dotenv/config"; // Đảm bảo đã cài `npm i dotenv`

const MONGO_URI = process.env.MONGODB_URI;
const DEFAULT_CURRENCY = "VND"; // Đặt đơn vị tiền tệ mặc định bạn muốn

/**
 * Script này sẽ tìm TẤT CẢ user trong CSDL
 * và gán cho họ một đơn vị tiền tệ mặc định.
 */
const setCurrencyForAllUsers = async () => {
  if (!MONGO_URI) {
    console.error("Lỗi: Biến môi trường MONGO_URI chưa được thiết lập.");
    process.exit(1);
  }

  let connection;
  try {
    connection = await mongoose.connect(MONGO_URI);
    console.log("✅ Đã kết nối tới MongoDB...");

    // --- Logic quan trọng ---
    // Chỉ cập nhật những user CHƯA CÓ trường 'currency'
    // Điều này giúp script an toàn khi chạy lại nhiều lần
    const filter = { currency: { $exists: false } };
    const update = { $set: { currency: DEFAULT_CURRENCY } };

    const result = await User.updateMany(filter, update);
    // ------------------------

    console.log("\n--- Kết quả cập nhật ---");
    console.log(
      `🔍 Đã tìm thấy: ${result.matchedCount} user (chưa có trường currency).`
    );
    console.log(`🔄 Đã cập nhật: ${result.modifiedCount} user.`);
    console.log(
      `👍 Đã gán đơn vị tiền tệ mặc định là '${DEFAULT_CURRENCY}'.`
    );
  } catch (error) {
    console.error("❌ Đã xảy ra lỗi trong quá trình cập nhật:", error);
  } finally {
    if (connection) {
      await mongoose.disconnect();
      console.log("\n🔌 Đã ngắt kết nối khỏi MongoDB.");
    }
  }
};

// Chạy script
setCurrencyForAllUsers();