import cron from 'node-cron';
import dayjs from 'dayjs';
import Budget from '../models/Budget';
import Notification from '../models/Notification';
import mongoose from 'mongoose';

// [Helper] Gửi thông báo VÀ cập nhật alertLevel (KHÔNG ĐỔI)
const sendNotificationAndUpdateLevel = async (
    user: mongoose.Types.ObjectId,
    message: string,
    type: 'budget_warning' | 'budget_category_warning',
    budgetId: mongoose.Types.ObjectId,
    newAlertLevel: number,
    isCategory: boolean = false,
    categoryName: string = ""
) => {
    // ... (Giữ nguyên logic helper này)
    const existing = await Notification.findOne({ user, type, message });
    if (existing) {
        console.log(`[Budget Alert] Đã gửi thông báo này trước đó, bỏ qua: ${message}`);
        return;
    }
    await Notification.create({ user, type, message });
    console.log(`[Budget Alert] user=${user}: ${message}`);

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
};


/**
 * [Refactored] Logic chính của Cron Job
 */
export const checkBudgetAlert = async () => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    console.log(`[Cron] Kiểm tra ngân sách T${currentMonth}/${currentYear} lúc ${now.toLocaleString()}`);

    // --- Biến thời gian cho query ---
    const startOfMonth = new Date(Date.UTC(currentYear, currentMonth - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0, 23, 59, 59, 999));

    try { // <-- Thêm try...catch để bắt lỗi aggregation
        // --- ÁP DỤNG PIPELINE ĐÃ TEST ---
        const budgetsWithSpending = await Budget.aggregate([
            // 1. Chỉ tìm budget của tháng này
            {
                $match: {
                    month: currentMonth,
                    year: currentYear
                }
            },
            // 2. Lấy TẤT CẢ giao dịch 'expense' của user đó trong tháng
            {
                $lookup: {
                    from: "transactions",
                    let: { userId: "$user" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$user", "$$userId"] },
                                        { $eq: ["$type", "expense"] },
                                        { $gte: ["$date", startOfMonth] },
                                        { $lte: ["$date", endOfMonth] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "transactions"
                }
            },
            // 3. "Mở" mảng transactions ra thành từng dòng
            {
                $unwind: {
                    path: "$transactions",
                    preserveNullAndEmptyArrays: true
                }
            },
            // 4. Nhóm theo Budget VÀ Category để tính tổng chi cho từng category
            {
                $group: {
                    _id: {
                        budgetId: "$_id",
                        category: { $ifNull: ["$transactions.category", "uncategorized"] }
                    },
                    doc: { $first: "$$ROOT" },
                    categorySpentBase: {
                        $sum: {
                            $ifNull: [
                                { $multiply: ["$transactions.amount", { $ifNull: ["$transactions.exchangeRate", 1] }] },
                                0
                            ]
                        }
                    }
                }
            },
            // 5. Nhóm lại theo Budget (gom các category lại)
            {
                $group: {
                    _id: "$_id.budgetId",
                    doc: { $first: "$doc" },
                    totalSpentBase: { $sum: "$categorySpentBase" },
                    categorySpentArray: {
                        $push: {
                            k: { $toString: "$_id.category" }, // Ép thành chuỗi
                            v: "$categorySpentBase"
                        }
                    }
                }
            },
            // 6. Tái cấu trúc lại document
            {
                $project: {
                    _id: "$_id",
                    user: "$doc.user",
                    month: "$doc.month",
                    year: "$doc.year",
                    totalAmount: "$doc.totalAmount",
                    alertLevel: "$doc.alertLevel",
                    categories: "$doc.categories",
                    totalSpentBase: "$totalSpentBase",
                    categorySpentMap: { $arrayToObject: "$categorySpentArray" }
                }
            }
        ]);
        // --- KẾT THÚC PIPELINE ---

        console.log(`[Cron] Tìm thấy ${budgetsWithSpending.length} budget của tháng này để kiểm tra.`);

        const thresholds = [80, 90, 100];

        // Lặp qua kết quả (LOGIC NÀY GIỮ NGUYÊN)
        for (const budget of budgetsWithSpending) {
            // ... (Logic lặp và sendNotificationAndUpdateLevel giữ nguyên)
            const {
                _id, user, month, year,
                totalAmount: totalBudgetBase,
                alertLevel = 0,
                categories,
                totalSpentBase,
                categorySpentMap
            } = budget;

            // --- A. Xử lý Ngân sách TỔNG ---
            const totalPercentUsed = totalBudgetBase > 0 ? Math.round((totalSpentBase / totalBudgetBase) * 100) : 0;
            for (const threshold of thresholds) {
                if (totalPercentUsed >= threshold && alertLevel < threshold) {
                    const message = `Bạn đã chi tiêu ${totalPercentUsed}% ngân sách tổng tháng ${month}/${year}.`;
                    await sendNotificationAndUpdateLevel(
                        user, message, 'budget_warning', _id, threshold, false
                    );
                    break;
                }
            }

            // --- B. Xử lý Ngân sách DANH MỤC ---
            if (!categories || categories.length === 0) continue;
            for (const catBudget of categories) {
                const { category, amount: categoryBudgetBase, alertLevel: oldCatAlertLevel = 0 } = catBudget;
                const spent = categorySpentMap[category] || 0;
                const percentUsed = categoryBudgetBase > 0 ? Math.round((spent / categoryBudgetBase) * 100) : 0;

                for (const threshold of thresholds) {
                    if (percentUsed >= threshold && oldCatAlertLevel < threshold) {
                        const message = `Bạn đã chi tiêu ${percentUsed}% ngân sách danh mục "${category}" tháng ${month}/${year}.`;
                        await sendNotificationAndUpdateLevel(
                            user, message, 'budget_category_warning', _id, threshold, true, category
                        );
                        break;
                    }
                }
            }
        }
    } catch (error) { // <-- Bắt lỗi nếu aggregation thất bại
        console.error("[Cron Error] Lỗi nghiêm trọng khi chạy checkBudgetAlert:", error);
        // Tùy chọn: Gửi thông báo lỗi cho admin ở đây
    }
};

/**
 * Hàm khởi tạo Cron Job (KHÔNG ĐỔI)
 */
export const initCheckBudgetAlert = () => {
    checkBudgetAlert(); // Dùng để test khi khởi động
    cron.schedule('30 0 * * *', checkBudgetAlert); // Chạy lúc 00:30 mỗi ngày
};