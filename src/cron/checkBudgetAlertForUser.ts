import dayjs from 'dayjs';
import Budget from '../models/Budget';
import Transaction, { ITransaction } from '../models/Transaction'; // Import ITransaction
import Notification from '../models/Notification';
import { Types } from 'mongoose';

// [Helper] Gửi thông báo VÀ cập nhật alertLevel (TÁCH RA RIÊNG)
// (Bạn có thể chuyển hàm này sang file utils nếu muốn dùng chung với cron)
const sendNotificationAndUpdateLevel = async (
    user: Types.ObjectId | string,
    message: string,
    type: 'budget_warning' | 'budget_category_warning',
    budgetId: Types.ObjectId,
    newAlertLevel: number,
    isCategory: boolean = false,
    categoryName: string = ""
) => {
    const existing = await Notification.findOne({ user, type, message });
    if (existing) {
        console.log(`[Budget Alert - User] Đã gửi thông báo này trước đó, bỏ qua: ${message}`);
        return false; // Trả về false nếu không gửi
    }
    await Notification.create({ user, type, message });
    console.log(`[Budget Alert - User] user=${user}: ${message}`);

    if (isCategory) {
        await Budget.updateOne(
            { _id: budgetId, "categories.category": categoryName },
            { $set: { "categories.$.alertLevel": newAlertLevel } }
        );
    } else {
        await Budget.updateOne(
            { _id: budgetId },
            { $set: { alertLevel: newAlertLevel } }
        );
    }
    return true; // Trả về true nếu đã gửi
};


/**
 * [Refactored] Kiểm tra ngân sách cho MỘT user (thường gọi sau khi tạo/sửa giao dịch).
 */
export const checkBudgetAlertForUser = async (userId: Types.ObjectId | string) => {
    console.log(`👉 Bắt đầu kiểm tra ngân sách tức thì cho user: ${userId}`);

    const now = dayjs();
    const month = now.month() + 1;
    const year = now.year();

    // Chỉ tìm budget của tháng hiện tại cho user này
    const budget = await Budget.findOne({
        user: userId,
        month: month,
        year: year
    });

    // Nếu không có budget cho tháng này, không cần làm gì
    if (!budget) {
        console.log(`⏩ User ${userId} không có budget cho tháng ${month}/${year}.`);
        return;
    }

    console.log(`✅ Đang kiểm tra ngân sách _id=${budget._id} (${month}/${year})`);

    const { _id: budgetId, totalAmount: totalBudgetBase, alertLevel = 0, categories } = budget;

    const start = now.startOf('month').toDate();
    const end = now.endOf('month').toDate();

    // Tìm tất cả giao dịch 'expense' trong tháng
    const transactions = await Transaction.find({
        user: userId,
        type: 'expense',
        date: { $gte: start, $lte: end },
    });

    console.log(`📊 Tìm thấy ${transactions.length} giao dịch chi tiêu trong tháng.`);

    // --- SỬA LỖI ĐA TIỀN TỆ ---
    // Tính tổng chi tiêu (luôn dùng VND)
    const totalSpentBase = transactions.reduce((sum, tx) => {
        return sum + (tx.amount * (tx.exchangeRate || 1));
    }, 0);

    // Tính chi tiêu theo danh mục (luôn dùng VND)
    const spentPerCategory: Record<string, number> = {};
    transactions.forEach(tx => {
        const categoryKey = tx.category || "uncategorized"; // Xử lý category null
        const baseAmount = tx.amount * (tx.exchangeRate || 1);
        spentPerCategory[categoryKey] = (spentPerCategory[categoryKey] || 0) + baseAmount;
    });
    // --- KẾT THÚC SỬA LỖI ---

    console.log(`💸 Đã chi (Base): ${totalSpentBase.toFixed(2)} / ${totalBudgetBase.toFixed(2)}`);

    const thresholds = [100, 90, 80]; // Kiểm tra từ cao xuống thấp để ưu tiên thông báo cao nhất

    let sentTotalAlert = false; // Cờ để chỉ gửi 1 thông báo tổng / lần chạy

    // === A. Kiểm tra Ngân sách TỔNG ===
    const totalPercentUsed = totalBudgetBase > 0 ? Math.round((totalSpentBase / totalBudgetBase) * 100) : 0;
    console.log(`📊 Tỷ lệ tổng: ${totalPercentUsed}% (Mức cảnh báo hiện tại: ${alertLevel}%)`);

    for (const threshold of thresholds) {
        if (totalPercentUsed >= threshold && alertLevel < threshold && !sentTotalAlert) {
            const message = `Bạn đã chi tiêu ${totalPercentUsed}% ngân sách tổng tháng ${month}/${year}.`;
            const sent = await sendNotificationAndUpdateLevel(
                userId, message, 'budget_warning', budgetId as Types.ObjectId, threshold, false
            );
            if (sent) sentTotalAlert = true; // Đánh dấu đã gửi
            // Không break vội, tiếp tục kiểm tra category
        }
    }

    // === B. Kiểm tra Ngân sách DANH MỤC ===
    if (!categories || categories.length === 0) {
      console.log('✅ Hoàn tất kiểm tra ngân sách (không có danh mục).');
      return;
    }

    // Không cần map qua updatedCategories nữa, dùng trực tiếp categories
    for (const catBudget of categories) {
        const { category, amount: categoryBudgetBase, alertLevel: oldCatAlertLevel = 0 } = catBudget;
        const spent = spentPerCategory[category] || 0; // Lấy từ map đã tính
        const percentUsed = categoryBudgetBase > 0 ? Math.round((spent / categoryBudgetBase) * 100) : 0;
        let sentCategoryAlert = false; // Cờ cho từng category

        console.log(`📁 Danh mục "${category}": đã chi ${spent.toFixed(2)}/${categoryBudgetBase.toFixed(2)} (${percentUsed}%), alertLevel: ${oldCatAlertLevel}%`);

        for (const threshold of thresholds) {
            if (percentUsed >= threshold && oldCatAlertLevel < threshold && !sentCategoryAlert) {
                const message = `Bạn đã chi tiêu ${percentUsed}% ngân sách danh mục "${category}" tháng ${month}/${year}.`;
                const sent = await sendNotificationAndUpdateLevel(
                    userId, message, 'budget_category_warning', budgetId as Types.ObjectId, threshold, true, category
                );
                 if (sent) sentCategoryAlert = true; // Đánh dấu đã gửi cho category này
                 // Không break, để đảm bảo alertLevel được cập nhật đúng mốc cao nhất
            }
        }
    }
    console.log(`✅ Hoàn tất kiểm tra ngân sách tức thì cho user: ${userId}\n`);
};