import cron from 'node-cron';
import Transaction from '../models/Transaction';
import { getLastDayOfMonth } from '../utils/getLastDayOfMonth';

/**
 * Cron job chạy mỗi ngày lúc 8:00 sáng
 * Duyệt qua các giao dịch recurring và tạo giao dịch mới nếu đến ngày trigger
 */
export const initRecurringTransactionJob = () => {
  // Chạy mỗi ngày lúc 8h sáng
  cron.schedule('0 8 * * *', async () => {
  // cron.schedule('*/1 * * * *', async () => { // Dùng để test nhanh mỗi phút

    const now = new Date();
    const today = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();

    // Lấy tất cả recurring transactions còn active
    const recurringTransactions = await Transaction.find({
      isRecurring: true,
      recurringDay: { $gte: 1, $lte: 31 },
    });

    console.log(`[Recurring] Tổng giao dịch định kỳ đang active: ${recurringTransactions.length}`);

    for (const tx of recurringTransactions) {
      const triggerDay = Math.min(tx.recurringDay as number, getLastDayOfMonth(year, month));

      console.log(
        `[Recurring] TX: ${tx.note || '(không có note)'} | user=${tx.user} | recurringDay=${tx.recurringDay} | triggerDay=${triggerDay} | hôm nay=${today}`
      );

      // Nếu hôm nay không trùng ngày lặp, skip
      if (triggerDay !== today) {
        console.log(`[Recurring] Bỏ qua: ${tx.note || '(no note)'} — chưa đến ngày thực thi.`);
        continue;
      }

      // Kiểm tra xem giao dịch này đã được tạo trong tháng hiện tại chưa
      const exists = await Transaction.findOne({
        user: tx.user,
        type: tx.type,
        category: tx.category,
        isRecurring: true,
        recurringDay: tx.recurringDay,
        date: {
          $gte: new Date(year, month, 1),
          $lt: new Date(year, month + 1, 1),
        },
      });

      if (exists) {
        console.log(`[Recurring] Bỏ qua: ${tx.note || '(no note)'} — đã tồn tại trong tháng.`);
        continue;
      }

      // Tạo giao dịch mới giống bản gốc (trừ createdAt/updatedAt)
      await Transaction.create({
        user: tx.user,
        amount: tx.amount,
        type: tx.type,
        category: tx.category,
        note: tx.note,
        date: new Date(year, month, triggerDay),
        isRecurring: true,
        recurringDay: tx.recurringDay,
        receiptImage: tx.receiptImage || [],
      });

      console.log(`[Recurring] ✅ Đã thêm mới: ${tx.note || '(no note)'} vào ${triggerDay}/${month + 1}`);
    }
  });
};
