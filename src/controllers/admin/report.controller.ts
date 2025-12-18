import path from "path";
import {ReportModel} from "../../models/Report"
import { Request, Response } from "express";
import fs from 'fs';
import { logAction } from "../../utils/logAction";
import { AuthRequest } from "../../middlewares/requireAuth";
import Notification from "../../models/Notification";

export const getReportById = async (req: AuthRequest, res: Response) => {
  const { reportId } = req.params; 

  try {
    const report = await ReportModel.findById(reportId)
      .populate("userId", "name email"); //

    if (!report) {
      res.status(404).json({ message: "Không tìm thấy báo cáo." });
      return;
    }

    res.json(report);
  } catch (error) {
    console.error("❌ Lỗi khi lấy báo cáo theo ID (admin):", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};

/**
 * Lấy tất cả báo cáo (có phân trang)
 * GET /admin/reports
 */
export const getAllReports = async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const reports = await ReportModel.find()
      .populate("userId", "name email") 
      .sort({ createdAt: -1 }) 
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
 * Xóa một báo cáo (bao gồm cả file PDF)
 * DELETE /admin/reports/:reportId
 */
export const deleteReport = async (req: AuthRequest, res: Response) => {
  const { reportId } = req.params;
  const { reason } = req.body; 

  try {
    const report = await ReportModel.findById(reportId);
    if (!report) {
      res.status(404).json({ message: "Không tìm thấy báo cáo" });
      return;
    }

    const message = `Một quản trị viên đã xóa báo cáo tháng ${report.month} của bạn. ${ //
      reason ? `<br/><b>Lý do:</b> ${reason}` : ""
    }`;

    await Notification.create({
      user: report.userId, 
      type: "admin_action",
      message: message,
    });

    const filePath = path.join(
      __dirname,
      "../../../public", 
      report.filePath.replace("static/", "") 
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Admin DeleteReport] Đã xóa file PDF: ${filePath}`);
    } else {
      console.warn(
        `[Admin DeleteReport] Không tìm thấy file PDF để xóa: ${filePath}`
      );
    }

    await ReportModel.findByIdAndDelete(reportId);

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