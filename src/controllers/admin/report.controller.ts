import path from "path";
import {ReportModel} from "../../models/Report"
import { Request, Response } from "express";
import fs from 'fs';
import { logAction } from "../../utils/logAction";
import { AuthRequest } from "../../middlewares/requireAuth";
import Notification from "../../models/Notification";

// --- HÀM MỚI BẠN VỪA CUNG CẤP - ĐÃ CẬP NHẬT ---
export const getReportById = async (req: AuthRequest, res: Response) => {
  const { reportId } = req.params; // Đổi tên param cho rõ nghĩa

  try {
    const report = await ReportModel.findById(reportId)
      // Thêm populate để lấy thông tin user, rất hữu ích cho admin
      .populate("userId", "name email"); //

    if (!report) {
      res.status(404).json({ message: "Không tìm thấy báo cáo." });
      return;
    }

    // Không cần logAction cho một hành động GET đơn giản
    res.json(report);
  } catch (error) {
    console.error("❌ Lỗi khi lấy báo cáo theo ID (admin):", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};
/**
 * [MỚI] Lấy tất cả báo cáo (có phân trang)
 * GET /admin/reports
 */
export const getAllReports = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const reports = await ReportModel.find()
      .populate("userId", "name email") // Liên kết đến model User
      .sort({ createdAt: -1 }) // Sắp xếp mới nhất lên đầu
      .skip(skip)
      .limit(limit);

    const total = await ReportModel.countDocuments();

    res.json({
      reports,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy tất cả báo cáo (admin):", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [MỚI] Xóa một báo cáo (bao gồm cả file PDF)
 * DELETE /admin/reports/:reportId
 */
export const deleteReport = async (req: AuthRequest, res: Response) => {
  const { reportId } = req.params;
  const { reason } = req.body; // <-- 2. LẤY LÝ DO TỪ BODY

  try {
    // 1. Tìm báo cáo trong CSDL
    const report = await ReportModel.findById(reportId);
    if (!report) {
      res.status(404).json({ message: "Không tìm thấy báo cáo" });
      return;
    }

    // 3. GỬI THÔNG BÁO CHO NGƯỜI DÙNG (TRƯỚC KHI XÓA)
    const message = `Một quản trị viên đã xóa báo cáo tháng ${report.month} của bạn. ${ //
      reason ? `<br/><b>Lý do:</b> ${reason}` : ""
    }`;

    await Notification.create({
      user: report.userId, //
      type: "admin_action",
      message: message,
    });
    // ------------------------------------

    // 4. Xóa file PDF vật lý
    const filePath = path.join(
      __dirname,
      "../../../public", // Đi ngược 3 cấp từ /dist/controllers/admin
      report.filePath.replace("static/", "") //
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Admin DeleteReport] Đã xóa file PDF: ${filePath}`);
    } else {
      console.warn(
        `[Admin DeleteReport] Không tìm thấy file PDF để xóa: ${filePath}`
      );
    }

    // 5. Xóa báo cáo khỏi CSDL
    await ReportModel.findByIdAndDelete(reportId);

    // 6. GHI LOG (Cập nhật lý do)
    await logAction(req, {
      action: "Admin Delete Report",
      statusCode: 200,
      description: `Admin đã xóa báo cáo ID: ${reportId} (File: ${
        report.filePath
      }) của user ${report.userId}. Lý do: ${reason || "Không có"}`,
    });

    res.json({ message: "Đã xóa báo cáo thành công" });
  } catch (err) {
    console.error("❌ Lỗi khi xóa báo cáo (admin):", err);
    await logAction(req, {
      action: "Admin Delete Report",
      statusCode: 500,
      description: `Lỗi khi xóa báo cáo ID: ${reportId}. Lý do: ${
        reason || "Không có"
      }`,
      level: "error",
    });
    res.status(500).json({ message: "Lỗi server" });
  }
};