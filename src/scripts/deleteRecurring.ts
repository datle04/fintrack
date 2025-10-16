// scripts/deleteRecurringTransactions.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import Transaction from "../models/Transaction";

dotenv.config(); // Để đọc file .env

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fintrack";

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Đã kết nối MongoDB");

    const result = await Transaction.deleteMany({ isRecurring: true });

    console.log(`🧹 Đã xóa ${result.deletedCount} giao dịch recurring`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi khi xóa giao dịch recurring:", error);
    process.exit(1);
  }
})();
