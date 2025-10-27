import cron from 'node-cron';
import Transaction, { ITransaction } from '../models/Transaction';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';
import Goal from '../models/Goal';

// 2. TÁCH HÀM HELPER RA (để dùng lại từ transactionController)
//    (Hoặc bạn import nó từ controller nếu bạn đã tách)
const updateGoalProgress = async (transaction: ITransaction) => {
  try {
    // Chỉ chạy nếu là 'expense' và có 'goalId'
    if (transaction.goalId && transaction.type === 'expense') { 
      const baseAmountToAdd = transaction.amount * transaction.exchangeRate;
      if (baseAmountToAdd === 0) return;

      await Goal.findByIdAndUpdate(transaction.goalId, {
        $inc: { currentBaseAmount: baseAmountToAdd },
      });
      console.log(`[Goal Update] Cron đã cập nhật Goal ${transaction.goalId} thêm ${baseAmountToAdd} VND`);
    }
  } catch (error) {
    console.error(`[Goal Update Error] Lỗi khi cron cập nhật mục tiêu ${transaction.goalId}:`, error);
  }
};


export const initRecurringTransactionJob = () => {
  // Chạy mỗi ngày lúc 8h sáng
  cron.schedule('0 8 * * *', async () => {
  // cron.schedule('*/1 * * * *', async () => { // Test

    const now = new Date();
    const today = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();

    // 3. SỬA FIND: Chỉ tìm các bản gốc (Template)
    const templates = await Transaction.find({
      isRecurring: true,
      date: undefined, // Chỉ tìm các template (không có ngày)
    });

    console.log(`[Recurring] Tổng TEMPLATE định kỳ đang active: ${templates.length}`);

    for (const template of templates) {
      const triggerDay = Math.min(template.recurringDay as number, getLastDayOfMonth(year, month));

      console.log(
        `[Recurring] TX: ${template.note || '(không có note)'} | user=${template.user} | triggerDay=${triggerDay} | hôm nay=${today}`
      );

      // Nếu hôm nay không trùng ngày lặp, skip
      if (triggerDay !== today) {
        console.log(`[Recurring] Bỏ qua: ${template.note || '(no note)'} — chưa đến ngày thực thi.`);
        continue;
      }

      // 4. SỬA EXISTS: Kiểm tra bằng recurringId
      const exists = await Transaction.findOne({
        recurringId: template.recurringId, // Dùng ID của chuỗi
        date: {
          $gte: new Date(year, month, 1),
          $lt: new Date(year, month + 1, 1),
        },
      });

      if (exists) {
        console.log(`[Recurring] Bỏ qua: ${template.note || '(no note)'} — đã tồn tại trong tháng.`);
        continue;
      }

      // 5. SỬA CREATE: Sao chép TẤT CẢ các trường quan trọng
      const newTx = await Transaction.create({
        user: template.user,
        amount: template.amount,
        type: template.type,
        category: template.category,
        note: template.note,
        date: new Date(year, month, triggerDay), // Ngày thực thi
        isRecurring: true,
        recurringDay: template.recurringDay,
        recurringId: template.recurringId, // <-- Thêm
        goalId: template.goalId,         // <-- Thêm
        currency: template.currency,     // <-- Thêm
        exchangeRate: template.exchangeRate, // <-- Thêm
        receiptImage: template.receiptImage || [],
      });

      console.log(`[Recurring] ✅ Đã thêm mới: ${newTx.note || '(no note)'} vào ${triggerDay}/${month + 1}`);
      
      // 6. GỌI HÀM CẬP NHẬT GOAL
      await updateGoalProgress(newTx);
    }
  });
};