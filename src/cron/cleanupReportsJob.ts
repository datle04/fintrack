// src/cron/cleanupReportsJob.ts
import cron from "node-cron";
import fs from "fs";
import path from "path";
import {ReportModel} from "../models/Report"; //
import { logAction } from "../utils/logAction"; //

// Định nghĩa thời gian lưu trữ (ví dụ: 180 ngày)
const MAX_REPORT_AGE_DAYS = 180;

const cleanupReports = async () => {
  console.log("🧹 [Cron] Bắt đầu tác vụ dọn dẹp báo cáo cũ...");

  try {
    // 1. Tính toán ngày giới hạn
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_REPORT_AGE_DAYS);

    // 2. Tìm tất cả báo cáo cũ hơn ngày giới hạn
    const oldReports = await ReportModel.find({
      createdAt: { $lt: cutoffDate }, //
    });

    if (oldReports.length === 0) {
      console.log("🧹 [Cron] Không tìm thấy báo cáo nào cần dọn dẹp.");
      return;
    }

    console.log(`🧹 [Cron] Tìm thấy ${oldReports.length} báo cáo cũ cần xóa...`);

    let deletedDbCount = 0;
    let deletedFileCount = 0;

    // 3. Lặp qua và xóa từng file
    for (const report of oldReports) {
      try {
        // Xóa file PDF vật lý
        const filePath = path.join(
          __dirname,
          "../../public", // Đi ngược 2 cấp từ /dist/cron
          report.filePath.replace("static/", "") //
        );

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedFileCount++;
        }

        // Xóa bản ghi trong CSDL
        await ReportModel.findByIdAndDelete(report._id);
        deletedDbCount++;
      } catch (err) {
        console.error(
          `❌ [Cron] Lỗi khi xóa báo cáo ID: ${report._id} (File: ${report.filePath})`,
          err
        );
      }
    }

    const logMessage = `Đã tự động dọn dẹp ${deletedDbCount} bản ghi báo cáo và ${deletedFileCount} file PDF (cũ hơn ${MAX_REPORT_AGE_DAYS} ngày).`;
    console.log(`🧹 [Cron] ${logMessage}`);

    // Ghi log hệ thống về hành động này
    await logAction(null, { // null vì đây là hành động của hệ thống, không phải của user
      action: "System Cleanup Reports",
      statusCode: 200,
      description: logMessage,
      level: "info",
    });

  } catch (error) {
    console.error("❌ [Cron] Lỗi nghiêm trọng trong tác vụ dọn dẹp báo cáo:", error);
    await logAction(null, {
        action: "System Cleanup Reports",
        statusCode: 500,
        description: "Tác vụ tự động dọn dẹp báo cáo thất bại.",
        level: "error",
    });
  }
};

/**
 * Lên lịch chạy tác vụ vào 3:00 sáng Chủ Nhật hàng tuần.
 * (Cú pháp cron: phút giờ ngày tháng ngày-trong-tuần)
 * 0 3 * * 0 = 3:00 AM Chủ Nhật
 */
export const startCleanupReportsJob = () => {
  // --- SỬA DÒNG NÀY ---
  // Xóa thuộc tính 'scheduled: true'
  cron.schedule("0 3 * * 0", cleanupReports, {
    timezone: "Asia/Ho_Chi_Minh",
  });
  // --------------------

  console.log("⏰ [Cron] Đã lên lịch tác vụ dọn dẹp báo cáo cũ (03:00 Chủ Nhật hàng tuần).");
};