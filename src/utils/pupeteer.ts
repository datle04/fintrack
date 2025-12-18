import puppeteer, { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { getBrowser } from './browser'; 

const cssPath = path.join(__dirname, './tailwind-report.css');
const tailwindCSS = fs.readFileSync(cssPath, 'utf8');

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

export const generatePDF = async (htmlBody: string, month: string, year: string) => {
  const browser = await getBrowser();
  const page: Page = await browser.newPage();

  try {
    const fullHtml = createFullHtml(htmlBody, month, year);

    await page.setContent(fullHtml, { waitUntil: 'load' });

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
        bottom: '60px', 
        left: '40px',
        right: '40px',
      },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>', 
      footerTemplate: footerTemplate, 
    });

    return pdfBuffer;

  } catch (error) {
    console.error("❌ Lỗi khi tạo PDF:", error);
    throw error; 
  } finally {
    await page.close(); 
  }
};