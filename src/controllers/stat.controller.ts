import { Response } from "express";
import { AuthRequest } from "../middlewares/requireAuth";
import dayjs from "dayjs";
import Transaction from "../models/Transaction";
import { Types } from "mongoose";

export const getCategoryStats = async ( req: AuthRequest, res: Response ) => {
    try {
        const { startDate, endDate, type } = req.query;

        const start = startDate
            ? dayjs(startDate as string).startOf('day').toDate()
            : dayjs().startOf('month').toDate();
        
        const end = endDate
            ? dayjs(endDate as string).endOf('day').toDate()
            : dayjs().endOf('month').toDate();

        const stats = await Transaction.aggregate([
            {
                $match: {
                    user:  new Types.ObjectId(req.userId),
                    type: type,
                    date: { $gte: start, $lt: end },
                    $or: [
                        { isRecurring: { $ne: true } },
                        { isRecurring: true, date: { $ne: null } }
                    ]
                }
            },
            {
                $group: {
                    _id: `$category`,
                    total: { $sum: '$amount' },
                },
            },
            {
                $project: {
                    category: '$_id',
                    total: 1,
                    _id: 0
                },
            },
            {
                $sort: { total: -1 }
            },
        ]);

        const txs = await Transaction.find({
            user: req.userId,
            type: type,
            date: { $gte: start, $lte: end },
        });

        console.log('[DEBUG] Sample amount types:');
        txs.forEach(tx => console.log(`- ${tx.amount} (${typeof tx.amount})`));

        res.json(stats);
    } catch (error) {
        res.status(500).json({ message: "Không thể lấy thống kê theo danh mục", error });
    }
};