// scripts/test-cron.ts
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import dotenv from 'dotenv';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';
import { recalculateGoalProgress} from '../services/goal.service';

dotenv.config();

// Copy nguyên cái logic bên trong hàm cron.schedule của bạn dán vào đây
// Nhưng thay đổi dòng lấy ngày giờ hiện tại:

const runTest = async () => {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("DB Connected");

    // 🔥 GIẢ LẬP: Đang là ngày 14 tháng sau (Tháng 1 năm 2026 chẳng hạn)
    console.log('🚀 START RECURRING JOB - BATCH PROCESSING');
    const now = new Date(2026, 0, 13, 8, 0, 0);
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
          batchPromises = [];
          await new Promise(resolve => setTimeout(resolve, 50)); 
        }
      }
  
      // Xử lý nốt những task còn lại trong batch cuối cùng
      if (batchPromises.length > 0) {
        await Promise.all(batchPromises);
      }
  
      console.log('✅ FINISHED RECURRING JOB');
  
  console.log("Test hoàn tất. Kiểm tra DB xem có record tháng 1/2026 chưa.");
};

runTest();