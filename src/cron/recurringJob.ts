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

    const BATCH_SIZE = 100; 
    let batchPromises: any[] = [];

    // 1. Dùng Cursor để Stream dữ liệu 
    const cursor = Transaction.find({
      isRecurring: true,
      date: null,
    }).cursor();

    const processTemplate = async (template: any) => {
      try {
        const lastDayOfMonth = getLastDayOfMonth(year, month);
        const triggerDay = Math.min(template.recurringDay, lastDayOfMonth);

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
          date: new Date(year, month, triggerDay), 
          isRecurring: true,
          recurringDay: template.recurringDay,
          recurringId: template.recurringId,
          goalId: template.goalId,
          currency: template.currency,
          exchangeRate: template.exchangeRate,
          receiptImage: [],
        });

        // Cập nhật Goal 
        if (newTx.goalId) {
          await recalculateGoalProgress(newTx.goalId);
        }
      } catch (err) {
        console.error(`Lỗi xử lý template ${template._id}:`, err);
      }
    };

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      // Đẩy task vào mảng batch
      batchPromises.push(processTemplate(doc));

      // Nếu mảng đầy 100 task -> Thực thi song song
      if (batchPromises.length >= BATCH_SIZE) {
        await Promise.all(batchPromises); 
        batchPromises = []; 
      }
    }

    // Xử lý nốt những task còn lại trong batch cuối cùng
    if (batchPromises.length > 0) {
      await Promise.all(batchPromises);
    }

    console.log('✅ FINISHED RECURRING JOB');
  }, { timezone: "Asia/Ho_Chi_Minh" });
};