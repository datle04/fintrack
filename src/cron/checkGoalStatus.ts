import cron from "node-cron";
import Goal from "../models/Goal";

const startGoalScanner = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("⏰ CRON JOB: Đang quét các mục tiêu hết hạn...");

    try {
      const now = new Date();

      const result = await Goal.updateMany(
        {
          status: "in_progress",
          $or: [
             { deadline: { $lt: now } }, 
             { targetDate: { $lt: now } } 
          ],
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