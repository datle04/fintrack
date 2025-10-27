import { AuthRequest } from "../middlewares/requireAuth";
import { Request, Response } from 'express';
import { getEndOfDay } from "../utils/dateHelper";
import Transaction from "../models/Transaction";
import mongoose from "mongoose";
import User from "../models/User";
import { getConversionRate, getExchangeRate } from "../services/exchangeRate";


// [GET] /api/dashboard
// [GET] /api/dashboard
export const getDashboardStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        
        // 1. Lấy params từ query
        const { startDate, endDate, currency: targetCurrencyQuery } = req.query;

        if (!userId) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        // --- SỬA LỖI ---
        
        // 2. Tiền tệ cơ sở của CSDL (Database) LUÔN là VND
        // Vì logic ($amount * $exchangeRate) của bạn được thiết kế để quy đổi về VND.
        const APP_BASE_CURRENCY = 'VND'; 

        // 3. Lấy tiền tệ mặc định MÀ USER MUỐN XEM
        const user = await User.findById(userId).select('currency').lean();
        const userPreferredCurrency = user?.currency || APP_BASE_CURRENCY;

        // 4. Xác định tiền tệ mục tiêu (target currency)
        // Ưu tiên 1: Lấy từ query (targetCurrencyQuery)
        // Ưu tiên 2: Lấy từ cài đặt của user (userPreferredCurrency)
        // Ưu tiên 3: Dùng VND
        const targetCurrency = 
            (targetCurrencyQuery as string) || 
            userPreferredCurrency;

        // --- KẾT THÚC SỬA LỖI ---


        // 5. Lấy tỷ giá quy đổi
        // Tỷ giá này là để đổi từ APP_BASE_CURRENCY (VND) sang targetCurrency
        let conversionRate = 1.0;
        try {
            // SỬA: Luôn quy đổi từ VND
            conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);
        } catch (rateError) {
            console.error("Lỗi API tỷ giá:", rateError);
            res.status(503).json({ message: "Lỗi dịch vụ tỷ giá hối đoái." });
            return;
        }
        
        console.log(`[Dashboard Stats] Base: ${APP_BASE_CURRENCY}, Target: ${targetCurrency}, Rate: ${conversionRate}`);

        // 6. Xử lý Date (như code cũ)
        const gteDate = new Date(startDate as string);
        gteDate.setUTCHours(0, 0, 0, 0);
        const lteDate = getEndOfDay(endDate as string);

        // 7. TÍNH TỔNG THU VÀ TỔNG CHI (Aggregation không đổi, vì nó đã đúng)
        const summary = await Transaction.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    date: { $gte: gteDate, $lte: lteDate },
                },
            },
            {
                $group: {
                    _id: "$type",
                    total: {
                        $sum: {
                            $multiply: [
                                // 1. Tính giá trị sang VND (APP_BASE_CURRENCY)
                                {
                                    $multiply: [
                                        "$amount",
                                        { $ifNull: ["$exchangeRate", 1] } 
                                    ]
                                },
                                // 2. Nhân với tỷ giá (VND -> Target Currency)
                                conversionRate
                            ]
                        },
                    },
                },
            },
        ]);

        let totalIncome = 0;
        let totalExpense = 0;
        summary.forEach((item) => {
            if (item._id === "income") {
                totalIncome = item.total;
            } else if (item._id === "expense") {
                totalExpense = item.total;
            }
        });

        // 8. TÍNH SỐ DƯ (BALANCE) (Aggregation không đổi)
        const totalHistorical = await Transaction.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    date: { $lte: lteDate },
                },
            },
            {
                $group: {
                    _id: "$type",
                    total: {
                        $sum: {
                            $multiply: [
                                {
                                    $multiply: [
                                        "$amount",
                                        { $ifNull: ["$exchangeRate", 1] }
                                    ]
                                },
                                conversionRate
                            ]
                        }
                    },
                },
            },
        ]);

        let historicalIncome = 0;
        let historicalExpense = 0;
        totalHistorical.forEach((item) => {
            if (item._id === "income") {
                historicalIncome = item.total;
            } else if (item._id === "expense") {
                historicalExpense = item.total;
            }
        });

        const balance = historicalIncome - historicalExpense;

        // 9. Trả về kết quả (Đã sửa lỗi bug trước đó)
        res.status(200).json({
            totalIncome: totalIncome.toFixed(2),
            totalExpense: totalExpense.toFixed(2),
            balance: balance.toFixed(2), // SỬA: Trả về 'balance'
            currency: targetCurrency 
        });

    } catch (error) {
        console.error("❌ Lỗi khi lấy Dashboard Data:", error);
        res.status(500).json({ message: "Không thể lấy dữ liệu Dashboard", error });
    }
};

export const getDashboardByMonths = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const currentYear = new Date().getFullYear();

    // Mảng kết quả cuối cùng
    const monthlyStats = await Promise.all(
    Array.from({ length: 12 }, async (_, month) => {
        const start = new Date(Date.UTC(currentYear, month, 1));
        const end = new Date(Date.UTC(currentYear, month + 1, 1));

        const transactions = await Transaction.find({
        user: userId,
        date: { $gte: start, $lt: end },
        });

        const income = transactions
        .filter((tx) => tx.type === "income")
        .reduce((sum, tx) => sum + tx.amount, 0);

        const expense = transactions
        .filter((tx) => tx.type === "expense")
        .reduce((sum, tx) => sum + tx.amount, 0);

        return {
        month: month + 1,
        income,
        expense,
        balance: income - expense,
        };
    })
    );
    res.json(monthlyStats);

  } catch (error) {
    console.error("Error in getDashboardByMonths:", error);
    res.status(500).json({ message: "Không thể lấy thống kê theo tháng", error });
  }
};