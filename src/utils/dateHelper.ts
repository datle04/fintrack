// 💡 Hàm Helper: Tính cuối ngày (23:59:59.999Z)
export const getEndOfDay = (dateString: string) => {
    // Tạo đối tượng Date mới từ chuỗi ngày (sẽ mặc định là 00:00:00Z)
    const date = new Date(dateString);
    // Đặt giờ/phút/giây/mili giây sang cuối ngày UTC (để lấy hết dữ liệu của ngày đó)
    date.setUTCHours(23, 59, 59, 999);
    return date;
}

// Hàm Helper: Đảm bảo Start Date là 00:00:00.000Z
export const getStartOfDay = (dateString: string) => {
    const date = new Date(dateString);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

// 💡 FIX 1B: Đảm bảo bắt đầu ngày là 00:00:00.000Z
export const getStartOfMonth = (year: number, month: number) => {
    // month trong JS Date là 0-indexed (tháng 1 là 0)
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

// 💡 FIX 1C: Tính cuối tháng theo UTC
export const getEndOfMonth = (year: number, month: number) => {
  // Lấy ngày cuối tháng bằng cách tạo ngày 0 của tháng kế tiếp
  const lastDay = new Date(Date.UTC(year, month, 0));
  return getEndOfDay(lastDay.toISOString());
};