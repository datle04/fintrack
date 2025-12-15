import cron from 'node-cron';
import Transaction from '../models/Transaction';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';
import Goal from '../models/Goal';
import { recalculateGoalProgress } from '../services/goal.service';

export const initRecurringTransactionJob = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log('🚀 START RECURRING JOB - BATCH PROCESSING');
    const now = new Date();
    const today = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();

    // Cấu hình Batch
    const BATCH_SIZE = 100; // Xử lý song song 100 giao dịch cùng lúc
    let batchPromises: any[] = [];

    // 1. Dùng Cursor để Stream dữ liệu (Không tốn RAM)
    const cursor = Transaction.find({
      isRecurring: true,
      date: null,
    }).cursor();

    // Hàm xử lý logic cho 1 template (Tách ra cho gọn)
    const processTemplate = async (template: any) => {
      try {
        const lastDayOfMonth = getLastDayOfMonth(year, month);
        const triggerDay = Math.min(template.recurringDay, lastDayOfMonth);

        // Logic "Catch-up": Chạy nếu đến ngày hoặc đã qua ngày
        if (triggerDay > today) return; 

        // Kiểm tra tồn tại
        const exists = await Transaction.exists({
          recurringId: template.recurringId,
          date: {
            $gte: new Date(year, month, 1),
            $lt: new Date(year, month + 1, 1),
          },
        });

        if (exists) return;

        // Tạo giao dịch
        const newTx = await Transaction.create({
          user: template.user,
          amount: template.amount,
          type: template.type,
          category: template.category,
          note: template.note,
          date: new Date(year, month, triggerDay), // Lưu đúng ngày kích hoạt
          isRecurring: true,
          recurringDay: template.recurringDay,
          recurringId: template.recurringId,
          goalId: template.goalId,
          currency: template.currency,
          exchangeRate: template.exchangeRate,
          receiptImage: [],
        });

        // Cập nhật Goal (nếu có)
        if (newTx.goalId) {
          await recalculateGoalProgress(newTx.goalId);
        }
      } catch (err) {
        console.error(`Lỗi xử lý template ${template._id}:`, err);
      }
    };

    // 2. Vòng lặp thông minh
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      // Đẩy task vào mảng batch
      batchPromises.push(processTemplate(doc));

      // Nếu mảng đầy 100 task -> Thực thi song song
      if (batchPromises.length >= BATCH_SIZE) {
        await Promise.all(batchPromises); // Chờ 100 cái này xong hết mới đi tiếp
        batchPromises = []; // Reset mảng để nhận 100 cái tiếp theo
        // (Optional) Cho nghỉ nhẹ 50ms để CPU thở nếu server yếu
        // await new Promise(resolve => setTimeout(resolve, 50)); 
      }
    }

    // Xử lý nốt những task còn lại trong batch cuối cùng
    if (batchPromises.length > 0) {
      await Promise.all(batchPromises);
    }

    console.log('✅ FINISHED RECURRING JOB');
  }, { timezone: "Asia/Ho_Chi_Minh" });
};