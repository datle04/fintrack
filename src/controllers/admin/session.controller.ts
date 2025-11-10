import { Request, Response } from "express";
import { SessionModel } from "../../models/Session";
import { AuthRequest } from "../../middlewares/requireAuth";

// Lấy thứ trong tuần: 1 (T2) → 7 (CN)
const getWeekday = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

export const getWeeklyDurationAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { mode = "week" } = req.query;

    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);

    const startDate =
      mode === "avg4weeks"
        ? new Date(monday.getTime() - 28 * 24 * 60 * 60 * 1000)
        : monday;

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    // Lấy tất cả sessions trong khoảng thời gian
    const sessions = await SessionModel.find({
      loginAt: { $gte: startDate, $lte: endDate },
    });

    // Gom nhóm theo thứ trong tuần
    const weekdayDurations: { [key: number]: number } = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0,
    };

    const uniqueUserIds = new Set<string>();

    sessions.forEach((session) => {
      const weekday = getWeekday(session.loginAt);
      weekdayDurations[weekday] += session.duration || 0;
      if (mode === "avg4weeks" && session.userId) {
        uniqueUserIds.add(session.userId.toString());
      }
    });

    // Nếu chế độ "avg4weeks", chia cho (4 tuần * số người dùng)
    if (mode === "avg4weeks") {
      const divisor = uniqueUserIds.size * 4 || 1; // tránh chia 0
      for (let i = 1; i <= 7; i++) {
        weekdayDurations[i] = Math.round(weekdayDurations[i] / divisor);
      }
    }

    res.json({
      mode,
      totalUsers: mode === "avg4weeks" ? uniqueUserIds.size : undefined,
      result: weekdayDurations,
    });
  } catch (err) {
    console.error("❌ Error in getWeeklyDurationAllUsers:", err);
    res.status(500).json({ message: "Lỗi server khi tính tổng duration!" });
  }
};
