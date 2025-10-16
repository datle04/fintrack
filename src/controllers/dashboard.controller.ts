import { AuthRequest } from "../middlewares/requireAuth";
import { Request, Response } from 'express';
import Transaction from "../models/Transaction";

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const filter: any = { user: req.userId };

    // 🧠 Xác định phạm vi ngày
    if (startDate && endDate) {
      // Nếu có cả startDate và endDate
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      // Đặt end = cuối ngày (23:59:59)
      end.setUTCHours(23, 59, 59, 999);

      filter.date = { $gte: start, $lte: end };
    } else {
      // Nếu không truyền ngày → mặc định là tháng hiện tại
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    // 🧾 Lấy giao dịch
    const transactions = await Transaction.find(filter);

    // 💰 Tính tổng thu - chi
    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((tx) => {
      if (tx.type === "income") totalIncome += tx.amount;
      else totalExpense += tx.amount;
    });

    const balance = totalIncome - totalExpense;

    // ✅ Trả về kết quả
    res.json({ totalIncome, totalExpense, balance });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ message: "Không thể lấy thống kê", error });
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