import User from "../../models/User";
import Transaction from "../../models/Transaction";
import { Request, Response } from "express";
import Log from "../../models/Log";
import {SessionModel} from "../../models/Session"
import { AuthRequest } from "../../middlewares/requireAuth";

export const getAdminDashboardStats = async (req: AuthRequest, res: Response) => {
  const userCount = await User.countDocuments();
  const transactionCount = await Transaction.countDocuments();

  // TÍNH TỔNG DỰA TRÊN TỶ GIÁ ---
  const totalIncome = await Transaction.aggregate([
    { $match: { type: "income" } },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
  ]);

  // TÍNH TỔNG DỰA TRÊN TỶ GIÁ ---
  const totalExpense = await Transaction.aggregate([
    { $match: { type: "expense" } },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
  ]);

  res.json({
    userCount,
    transactionCount,
    totalIncome: totalIncome[0]?.total || 0,
    totalExpense: totalExpense[0]?.total || 0,
  });
};

export const getMonthlyIncomeExpenseStats = async (req: AuthRequest, res: Response) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear();

  const startOfYear = new Date(year, 0, 1);   // 1 Jan
  const endOfYear = new Date(year, 11, 31, 23, 59, 59); // 31 Dec

  const stats = await Transaction.aggregate([
    {
      $match: {
        date: { $gte: startOfYear, $lte: endOfYear }, 
      },
    },
    {
      $group: {
        _id: {
          month: { $month: "$date" }, 
          type: "$type",              
        },
        // --- SỬA LỖI 3: TÍNH TỔNG DỰA TRÊN TỶ GIÁ ---
        total: {
          $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] },
        },
      },
    },
    {
      $group: {
        _id: "$_id.month",
        income: {
          $sum: {
            $cond: [{ $eq: ["$_id.type", "income"] }, "$total", 0],
          },
        },
        expense: {
          $sum: {
            $cond: [{ $eq: ["$_id.type", "expense"] }, "$total", 0],
          },
        },
      },
    },
    {
      $sort: { _id: 1 }, // sắp xếp theo tháng
    },
  ]);

  // Đảm bảo có đủ 12 tháng
  const result = Array.from({ length: 12 }, (_, i) => {
    const found = stats.find((s) => s._id === i + 1);
    return {
      month: i + 1,
      income: found?.income || 0,
      expense: found?.expense || 0,
    };
  });

  res.json(result);
};

export const getMonthlyTransactionCount = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const startOfYear = new Date(year, 0, 1);   
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const stats = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: startOfYear, $lte: endOfYear }, // 
        },
      },
      {
        $group: {
          _id: { month: { $month: "$date" } },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.month": 1 },
      },
    ]);

    const result = Array.from({ length: 12 }, (_, i) => {
      const monthStat = stats.find((s) => s._id.month === i + 1);
      return {
        month: i + 1,
        count: monthStat?.count || 0,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("❌ Lỗi khi lấy transaction count theo tháng:", err);
    res.status(500).json({ message: "Lỗi server khi lấy dữ liệu!" });
  }
};

// =============================================
// === CÁC HÀM API MỚI BỔ SUNG ===
// =============================================

/**
 * [MỚI] API Lấy số lượng người dùng đăng ký mới (7 ngày qua)
 * GET /admin/dashboard/user-signups
 */
export const getNewUserSignups = async (req: AuthRequest, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const signups = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }, // Chỉ lấy user tạo trong 7 ngày
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 }, // Sắp xếp theo ngày
      },
    ]);

    res.json(signups);
  } catch (err) {
    console.error("❌ Lỗi khi lấy thống kê đăng ký mới:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [MỚI] API Lấy các log lỗi gần đây
 * GET /admin/dashboard/recent-errors?limit=5
 */
export const getRecentErrorLogs = async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    const logs = await Log.find({ level: "error" }) // Chỉ lấy log 'error'
      .sort({ timestamp: -1 }) // Sắp xếp mới nhất lên đầu
      .limit(limit)
      .populate("user", "name email"); // Lấy thông tin user liên quan

    res.json(logs);
  } catch (err) {
    console.error("❌ Lỗi khi lấy log lỗi gần đây:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [ĐÃ SỬA] API Thống kê người dùng hoạt động
 * GET /admin/dashboard/active-users
 */
export const getActiveUsersStats = async (req: AuthRequest, res: Response) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // --- SỬA 1: Dùng đúng tên trường "userId" và "loginAt" ---
    const activeLast24h = await SessionModel.distinct("userId", {
      loginAt: { $gte: twentyFourHoursAgo }, 
    });

    // --- SỬA 2: Dùng đúng tên trường "logoutAt" ---
    const currentlyOnline = await SessionModel.countDocuments({
      logoutAt: null, 
    });
    // --------------------------------------------

    res.json({
      activeLast24h: activeLast24h.length,
      currentlyOnline: currentlyOnline,
    });
  } catch (err) {
    console.error("❌ Lỗi khi lấy thống kê người dùng hoạt động:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * [MỚI] API Lấy top danh mục chi tiêu toàn hệ thống
 * GET /admin/dashboard/top-categories?limit=5
 */
export const getTopExpenseCategories = async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    const categories = await Transaction.aggregate([
      {
        $match: { type: "expense" }, // Chỉ lấy giao dịch 'expense'
      },
      {
        $group: {
          _id: "$category", // Nhóm theo danh mục
          totalSpent: {
            // Tính tổng đã quy đổi (như đã sửa)
            $sum: { $multiply: ["$amount", { $ifNull: ["$exchangeRate", 1] }] }, //
          },
          count: { $sum: 1 }, // Đếm số lượng giao dịch
        },
      },
      {
        $sort: { totalSpent: -1 }, // Sắp xếp theo tổng chi
      },
      {
        $limit: limit,
      },
    ]);

    res.json(categories);
  } catch (err) {
    console.error("❌ Lỗi khi lấy top danh mục:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
};