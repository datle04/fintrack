import cron from 'node-cron';
import dayjs from 'dayjs';
import Budget from '../models/Budget';
import Transaction from '../models/Transaction';
import Notification from '../models/Notification';
import { Types } from 'mongoose';

export const checkBudgetAlertForUser = async (userId: Types.ObjectId | string) => {
  console.log(`👉 Bắt đầu kiểm tra ngân sách cho user: ${userId}`);

  const budgets = await Budget.find({ user: userId });
  console.log(`🧾 Tìm thấy ${budgets.length} ngân sách cho user.`);

  const now = dayjs();
  const month = now.month() + 1;
  const year = now.year();

  for (const budget of budgets) {
    if (budget.month !== month || budget.year !== year) {
      console.log(`⏩ Bỏ qua ngân sách tháng ${budget.month}/${budget.year} (hiện tại: ${month}/${year})`);
      continue;
    }

    console.log(`✅ Đang kiểm tra ngân sách _id=${budget._id} (${month}/${year})`);

    const { totalAmount, alertLevel = 0, categories } = budget;

    const start = dayjs(`${year}-${month}-01`).startOf('month').toDate();
    const end = dayjs(`${year}-${month}-01`).endOf('month').toDate();

    const transactions = await Transaction.find({
      user: userId,
      type: 'expense',
      date: { $gte: start, $lte: end },
    });

    console.log(`📊 Tìm thấy ${transactions.length} giao dịch chi tiêu trong tháng.`);

    const totalSpent = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const totalPercentUsed = Math.round((totalSpent / totalAmount) * 100);
    console.log(`💸 Đã chi: ${totalSpent} / ${totalAmount} (${totalPercentUsed}%)`);

    const thresholds = [80, 90, 100];

    for (const threshold of thresholds) {
      if (totalPercentUsed >= threshold && alertLevel < threshold) {
        const message = `Bạn đã chi tiêu ${totalPercentUsed}% ngân sách tổng tháng ${month}/${year}.`;
        const existing = await Notification.findOne({ user: userId, type: 'budget_warning', message });

        console.log(`⚠️ Cảnh báo tổng: ${message}`);
        console.log(existing ? '🛑 Đã tồn tại thông báo này' : '✅ Tạo thông báo mới');

        if (!existing) {
          await Notification.create({ user: userId, type: 'budget_warning', message });
          await Budget.updateOne({ _id: budget._id }, { $set: { alertLevel: threshold } });
        }
        break;
      }
    }

    // === Danh mục ===
    const spentPerCategory: Record<string, number> = {};
    transactions.forEach(tx => {
      spentPerCategory[tx.category] = (spentPerCategory[tx.category] || 0) + tx.amount;
    });

    const updatedCategories = categories.map(cat => ({ ...cat }));

    for (let i = 0; i < updatedCategories.length; i++) {
      const catBudget = updatedCategories[i];
      const spent = spentPerCategory[catBudget.category] || 0;
      const percentUsed = Math.round((spent / catBudget.amount) * 100);
      const oldAlertLevel = catBudget.alertLevel ?? 0;

      console.log(`📁 Danh mục "${catBudget.category}": đã chi ${spent}/${catBudget.amount} (${percentUsed}%), alertLevel hiện tại: ${oldAlertLevel}`);

      for (const threshold of thresholds) {
        if (percentUsed >= threshold && oldAlertLevel < threshold) {
          const message = `Bạn đã chi tiêu ${percentUsed}% ngân sách danh mục "${catBudget.category}" tháng ${month}/${year}.`;
          const existing = await Notification.findOne({ user: userId, type: 'budget_category_warning', message });

          console.log(`⚠️ Cảnh báo danh mục: ${message}`);
          console.log(existing ? '🛑 Đã tồn tại thông báo này' : '✅ Tạo thông báo mới');

          if (!existing) {
            await Notification.create({ user: userId, type: 'budget_category_warning', message });
            updatedCategories[i].alertLevel = threshold;
          }
          break;
        }
      }
    }

    await Budget.updateOne({ _id: budget._id }, { $set: { categories: updatedCategories } });
    console.log('✅ Đã cập nhật alertLevel cho các danh mục nếu có thay đổi');
  }

  console.log(`✅ Hoàn tất kiểm tra ngân sách cho user: ${userId}\n`);
};
