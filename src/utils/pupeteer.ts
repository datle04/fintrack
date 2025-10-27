// utils/puppeteer.ts (hoặc file cũ của bạn)
import puppeteer, { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { getBrowser } from './browser'; // <-- Import trình duyệt dùng chung

// --- TỐI ƯU 1: CACHE CSS ---
// Đọc CSS một lần duy nhất khi server khởi động
const cssPath = path.join(__dirname, './tailwind-report.css');// <-- Đường dẫn file CSS đã purge
const tailwindCSS = fs.readFileSync(cssPath, 'utf8');

/**
 * Tạo một chuỗi HTML hoàn chỉnh, sẵn sàng để "in"
 */
const createFullHtml = (htmlBody: string, month: string, year: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Báo cáo tài chính ${month}/${year}</title>
      <style>${tailwindCSS}</style>
      
      <style>
        section, table, img, .no-break {
          break-inside: avoid;
        }
      </style>
    </head>

    <body>
      ${htmlBody}
    </body>
    </html>
  `;
};

/**
 * Hàm generatePDF đã được tối ưu
 */
export const generatePDF = async (htmlBody: string, month: string, year: string) => {
  // --- TỐI ƯU 4: DÙNG TRÌNH DUYỆT CHUNG ---
  const browser = await getBrowser();
  const page: Page = await browser.newPage();

  try {
    // Tạo HTML đầy đủ
    const fullHtml = createFullHtml(htmlBody, month, year);

    // Tải nội dung
    // 'networkidle0' là CẦN THIẾT để chờ Google Fonts tải xong
    await page.setContent(fullHtml, { waitUntil: 'load' });

    // --- TỐI ƯU 5: THÊM HEADER/FOOTER VÀ SỐ TRANG ---
    const footerTemplate = `
      <div style="font-family: Arial, sans-serif; font-size: 9px; text-align: center; width: 100%; color: #888; padding: 0 40px;">
        Báo cáo tháng ${month}/${year}
        <span style="float: right;">
          Trang <span class="pageNumber"></span> / <span class="totalPages"></span>
        </span>
      </div>
    `;

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '40px',
        bottom: '60px', // Thêm lề dưới để chứa footer
        left: '40px',
        right: '40px',
      },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>', // Header rỗng
      footerTemplate: footerTemplate, // Dùng footer có số trang
    });

    return pdfBuffer;

  } catch (error) {
    console.error("❌ Lỗi khi tạo PDF:", error);
    throw error; // Ném lỗi để controller bắt được
  } finally {
    await page.close(); // <-- Chỉ đóng trang, không đóng trình duyệt
  }
};