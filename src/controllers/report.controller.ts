import path from 'path';
import fs from 'fs';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ReportModel } from '../models/Report';
import { AuthRequest } from '../middlewares/requireAuth';
// Import hàm generatePDF đã tối ưu
import { generatePDF } from '../utils/pupeteer'; // <-- Đảm bảo bạn import đúng file
import { logAction } from '../utils/logAction';

export const exportReport = async (req: AuthRequest, res: Response) => {
  // Lấy chuỗi "MM-YYYY" từ body (ví dụ: "10-2025")
  const { html, month: monthYearString } = req.body; 
  const userId = req.userId;

  if (!html || !monthYearString) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }

  // --- THAY ĐỔI 1: Tách chuỗi "MM-YYYY" ---
  const [month, year] = monthYearString.split('-');
  if (!month || !year) {
    // Gửi lỗi nếu frontend gửi sai định dạng
    res.status(400).json({ message: 'Invalid month format. Expected "MM-YYYY"' });
    return;
  }
  // Giờ bạn đã có: month = "10", year = "2025"

  try {
    // Logic caching vẫn giữ nguyên, nó tìm theo chuỗi "MM-YYYY"
    const existingReport = await ReportModel.findOne({ userId, month: monthYearString });

    if (existingReport) {
      await logAction(req, {
        action: 'Export Report',
        statusCode: 200,
        // Log vẫn dùng chuỗi "MM-YYYY"
        description: `Lấy lại báo cáo tháng ${monthYearString} - ID: ${existingReport.reportId}`, 
      });

      res.status(200).json({ report: existingReport });
      return;
    }

    const reportId = uuidv4();

    // --- THAY ĐỔI 2: Gọi hàm generatePDF với 3 tham số ---
    const pdfBuffer = await generatePDF(html, month, year);

    // Phần còn lại của code giữ nguyên...
    const fileName = `${reportId}.pdf`;
    const dirPath = path.join(__dirname, '../../public/reports');

    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const filePath = path.join(dirPath, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    const report = await ReportModel.create({
      reportId,
      userId,
      month: monthYearString, // Lưu chuỗi "MM-YYYY" vào CSDL
      filePath: `static/reports/${fileName}`,
    });

    await logAction(req, {
      action: 'Export Report',
      statusCode: 200,
      description: `Xuất báo cáo mới tháng ${monthYearString} - ID: ${reportId}`,
    });

    res.status(200).json({ report });
  } catch (err) {
    console.error('Export report error:', err);

    await logAction(req, {
      action: 'Export Report',
      statusCode: 500,
      description: 'Lỗi khi xuất báo cáo',
      level: 'error',
    });

    res.status(500).json({ message: 'Export failed', error: err });
  }
};