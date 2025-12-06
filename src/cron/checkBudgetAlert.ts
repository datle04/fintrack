import cron from 'node-cron';
import Budget from '../models/Budget';
import { getThresholdLevel, updateAlertLevelAndNotify } from '../services/budget.alert.service';
import { Types } from 'mongoose';

/**
 * Cron Job: Quét toàn bộ ngân sách để kiểm tra cảnh báo
 * (Dùng để "vét" các giao dịch định kỳ hoặc lỗi sót từ real-time)
 */
export const checkBudgetAlert = async () => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; 
    const currentYear = now.getFullYear();

    console.log(`[Cron] 🕒 Kiểm tra ngân sách T${currentMonth}/${currentYear} lúc ${now.toLocaleString()}`);

    const startOfMonth = new Date(Date.UTC(currentYear, currentMonth - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0, 23, 59, 59, 999));

    try {
        // --- AGGREGATION PIPELINE (GIỮ NGUYÊN CỦA BẠN - RẤT TỐT) ---
        const budgetsWithSpending = await Budget.aggregate([
            // ... (Copy nguyên xi pipeline từ code cũ của bạn vào đây) ...
            // ... Từ $match đến $project ...
            {
                $match: { month: currentMonth, year: currentYear }
            },
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
            {
                $unwind: { path: "$transactions", preserveNullAndEmptyArrays: true }
            },
            {
                $group: {
                    _id: { budgetId: "$_id", category: { $ifNull: ["$transactions.category", "uncategorized"] } },
                    doc: { $first: "$$ROOT" },
                    categorySpentBase: {
                        $sum: {
                            $ifNull: [{ $multiply: ["$transactions.amount", { $ifNull: ["$transactions.exchangeRate", 1] }] }, 0]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$_id.budgetId",
                    doc: { $first: "$doc" },
                    totalSpentBase: { $sum: "$categorySpentBase" },
                    categorySpentArray: {
                        $push: { k: { $toString: "$_id.category" }, v: "$categorySpentBase" }
                    }
                }
            },
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

        console.log(`[Cron] 📊 Tìm thấy ${budgetsWithSpending.length} budget.`);

        // --- LOGIC XỬ LÝ (ĐÃ CẬP NHẬT THEO SYNC STATE) ---
        // Sử dụng Promise.all để chạy nhanh hơn thay vì loop tuần tự
        await Promise.all(budgetsWithSpending.map(async (budget) => {
            const {
                _id, user, month, year,
                totalAmount: totalBudgetBase,
                alertLevel: dbTotalLevel = 0,
                categories,
                totalSpentBase,
                categorySpentMap
            } = budget;

            // === A. Xử lý Ngân sách TỔNG ===
            const totalPercent = totalBudgetBase > 0 
                ? Math.round((totalSpentBase / totalBudgetBase) * 100) 
                : 0;
            
            const currentTotalLevel = getThresholdLevel(totalPercent);

            // Gọi Helper chung (xử lý cả tăng và giảm)
            if (currentTotalLevel !== dbTotalLevel) {
                const message = `⚠️ Cảnh báo: Bạn đã tiêu ${totalPercent}% tổng ngân sách tháng ${month}/${year}.`;
                await updateAlertLevelAndNotify(
                    user,
                    _id as Types.ObjectId,
                    currentTotalLevel,
                    dbTotalLevel,
                    false, // isCategory
                    "",
                    message
                );
            }

            // === B. Xử lý Ngân sách DANH MỤC ===
            if (categories && categories.length > 0) {
                await Promise.all(categories.map(async (cat: any) => {
                    const { category, amount: catBudget, alertLevel: dbCatLevel = 0 } = cat;
                    
                    const spent = categorySpentMap[category] || 0;
                    const catPercent = catBudget > 0 
                        ? Math.round((spent / catBudget) * 100) 
                        : 0;
                    
                    const currentCatLevel = getThresholdLevel(catPercent);

                    if (currentCatLevel !== dbCatLevel) {
                        const message = `⚠️ Danh mục "${category}" đã dùng hết ${catPercent}% ngân sách.`;
                        await updateAlertLevelAndNotify(
                            user,
                            _id as Types.ObjectId,
                            currentCatLevel,
                            dbCatLevel,
                            true, // isCategory
                            category,
                            message
                        );
                    }
                }));
            }
        }));

        console.log(`[Cron] ✅ Hoàn tất kiểm tra.`);

    } catch (error) {
        console.error("[Cron Error] ❌ Lỗi nghiêm trọng:", error);
    }
};

export const initCheckBudgetAlert = () => {
    // Chạy ngay khi khởi động server (để test)
    checkBudgetAlert(); 
    // Lên lịch chạy hàng ngày lúc 00:30
    cron.schedule('30 0 * * *', checkBudgetAlert); 
};