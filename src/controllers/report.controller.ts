import path from 'path';
import fs from 'fs';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ReportModel } from '../models/Report';
import { AuthRequest } from '../middlewares/requireAuth';
import { generatePDF } from '../utils/pupeteer'; 
import { logAction } from '../utils/logAction';

export const exportReport = async (req: AuthRequest, res: Response) => {
  const { html, month: monthYearString } = req.body; 
  const userId = req.userId;

  if (!html || !monthYearString) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }

  const [month, year] = monthYearString.split('-');
  if (!month || !year) {
    res.status(400).json({ message: 'Invalid month format. Expected "MM-YYYY"' });
    return;
  }

  try {
    const existingReport = await ReportModel.findOne({ userId, month: monthYearString });

    if (existingReport) {
      await logAction(req, {
        action: 'Export Report',
        statusCode: 200,
        description: `Lấy lại báo cáo tháng ${monthYearString} - ID: ${existingReport.reportId}`, 
      });

      res.status(200).json({ report: existingReport });
      return;
    }

    const reportId = uuidv4();

    const pdfBuffer = await generatePDF(html, month, year);

    const fileName = `${reportId}.pdf`;
    const dirPath = path.join(__dirname, '../../public/reports');

    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const filePath = path.join(dirPath, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    const report = await ReportModel.create({
      reportId,
      userId,
      month: monthYearString, 
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