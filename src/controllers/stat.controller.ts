import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';     // <-- Cập nhật đường dẫn
import Transaction from '../models/Transaction';      // <-- Cập nhật đường dẫn
import User from '../models/User';                  // <-- THÊM DÒNG NÀY
import { getStartOfDay, getEndOfDay } from '../utils/dateHelper'; // <-- Cập nhật đường dẫn
import { getConversionRate } from '../services/exchangeRate';

// [GET] /api/stats/category-stats (Assuming this is the endpoint)
export const getCategoryStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        
        // 1. Lấy params từ query
        const { type = "", startDate, endDate, currency: targetCurrencyQuery } = req.query; 

        if (!userId) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        
        if (!startDate || !endDate) {
            res.status(400).json({ message: "Thiếu startDate, endDate." });
            return;
        }

        // 2. Tiền tệ cơ sở của CSDL (Database) LUÔN là VND
        const APP_BASE_CURRENCY = 'VND'; 

        // 3. Lấy tiền tệ mặc định MÀ USER MUỐN XEM
        const user = await User.findById(userId).select('currency').lean();
        const userPreferredCurrency = user?.currency || APP_BASE_CURRENCY;

        // 4. Xác định tiền tệ mục tiêu (target currency)
        const targetCurrency = 
            (targetCurrencyQuery as string) || 
            userPreferredCurrency;

        // 5. Lấy tỷ giá quy đổi
        let conversionRate = 1.0;
        try {
            // Luôn quy đổi từ VND (Base) sang Target (Display)
            conversionRate = await getConversionRate(APP_BASE_CURRENCY, targetCurrency);
        } catch (rateError) {
            console.error("Lỗi API tỷ giá:", rateError);
            res.status(503).json({ message: "Lỗi dịch vụ tỷ giá hối đoái." });
            return;
        }
        
        console.log(`[Category Stats] Base: ${APP_BASE_CURRENCY}, Target: ${targetCurrency}, Rate: ${conversionRate}`);

        // 6. Chuẩn hóa ngày tháng theo UTC
        const gteDate = getStartOfDay(startDate as string);
        const lteDate = getEndOfDay(endDate as string);

        // 7. Thực hiện Aggregation
        const aggregationResult = await Transaction.aggregate([
            {
                // Giai đoạn 1: Lọc giao dịch
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    type: type, 
                    date: { $gte: gteDate, $lte: lteDate },
                },
            },
            {
                // Giai đoạn 2: Nhóm và CHỈ TÍNH TỔNG baseAmount (VND)
                $group: {
                    _id: "$category",
                    // Tính tổng giá trị đã quy đổi về VND (Base)
                    baseAmount: { 
                        $sum: { 
                            $multiply: [
                                "$amount",
                                { $ifNull: ["$exchangeRate", 1] } 
                            ]
                        } 
                    },
                },
            },
            {
                // Giai đoạn 3: Tính displayAmount từ baseAmount
                $project: {
                    _id: 0, // Bỏ trường _id
                    category: "$_id", // Đổi tên _id thành category
                    baseAmount: "$baseAmount", // Giữ lại baseAmount đã tính
                    // Tính displayAmount bằng cách nhân
                    displayAmount: { $multiply: ["$baseAmount", conversionRate] }
                }
            },
            {
                // Giai đoạn 4: Sắp xếp
                $sort: { baseAmount: -1 } // Sắp xếp theo baseAmount
            }
        ]);

        // 8. Chuẩn hóa kết quả
        const stats = aggregationResult
            .filter(item => item.baseAmount > 0) 
            .map(item => ({
                category: item.category,
                // Làm tròn 2 chữ số thập phân
                baseAmount: Number(item.baseAmount.toFixed(2)), 
                displayAmount: Number(item.displayAmount.toFixed(2)),
            }));

        // 9. Trả về object chứa stats và currency (của displayAmount)
        res.status(200).json({
            stats: stats,
            currency: targetCurrency 
        });

    } catch (error) {
        console.error("❌ Lỗi khi lấy Category Stats:", error);
        res.status(500).json({ message: "Không thể lấy thống kê danh mục", error });
    }
};