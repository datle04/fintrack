import puppeteer, { Browser } from 'puppeteer';

let browserInstance: Browser | null = null;

/**
 * Khởi động và trả về một instance trình duyệt (chỉ chạy 1 lần).
 */
export const getBrowser = async (): Promise<Browser> => {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  console.log('🚀 Khởi động trình duyệt Puppeteer (chỉ một lần)...');
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process'
    ],
  });

  browserInstance.on('disconnected', () => {
    console.log('❌ Trình duyệt Puppeteer đã bị ngắt kết nối.');
    browserInstance = null;
  });

  return browserInstance;
};

/**
 * (Tùy chọn) Bạn có thể gọi hàm này khi tắt server
 */
export const closeBrowser = async () => {
  if (browserInstance) {
    await browserInstance.close();
    console.log('✅ Đã đóng trình duyệt Puppeteer.');
  }
};

getBrowser();