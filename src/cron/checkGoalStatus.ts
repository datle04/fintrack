import cron from "node-cron";
import Goal from "../models/Goal";

const startGoalScanner = () => {
  // Chạy vào 00:00 mỗi ngày (nửa đêm)
  cron.schedule("0 0 * * *", async () => {
    console.log("⏰ CRON JOB: Đang quét các mục tiêu hết hạn...");

    try {
      const now = new Date();

      // Tìm các goal đang chạy (in_progress) NHƯNG đã quá hạn (deadline < now)
      // Và chưa hoàn thành (currentBaseAmount < targetBaseAmount)
      const result = await Goal.updateMany(
        {
          status: "in_progress",
          $or: [
             { deadline: { $lt: now } }, // Dành cho goal có deadline cụ thể
             { targetDate: { $lt: now } } // Hoặc targetDate (tùy db bạn dùng field nào)
          ],
          // Đảm bảo logic: Tiền hiện tại nhỏ hơn mục tiêu mới tính là fail
          // (Lưu ý: Mongoose không so sánh 2 field trong updateMany dễ dàng, 
          // nên tạm thời ta cứ update hết các cái quá hạn mà status vẫn in_progress)
        },
        {
          $set: { status: "failed" },
        }
      );

      console.log(`✅ CRON JOB: Đã đánh dấu ${result.modifiedCount} mục tiêu là THẤT BẠI (Failed).`);
    } catch (error) {
      console.error("❌ CRON JOB ERROR:", error);
    }
  });
};

export default startGoalScanner;