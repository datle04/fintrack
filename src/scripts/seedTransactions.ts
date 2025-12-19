import mongoose from 'mongoose';
import Transaction from '../models/Transaction'; // 🔥 Đảm bảo trỏ đúng model

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const USER_ID = "6933edda5f0184301a4616cb";
const YEAR = 2025;
const MONGO_URI = "mongodb+srv://ldat0909:Letandat31102004@cluster0.3wglbsv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; 

// ----------------------------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------------------------
const getRandomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const roundAmount = (amount: number) => Math.ceil(amount / 1000) * 1000;
const setRandomTime = (date: Date) => {
    date.setHours(getRandomInt(7, 22), getRandomInt(0, 59), 0, 0);
    return date;
};

// ----------------------------------------------------------------------
// MAIN LOGIC
// ----------------------------------------------------------------------
const seedTransactions = async () => {
    try {
        console.log("🚀 Đang kết nối MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Kết nối thành công!");

        const transactions: any[] = [];

        // Chạy từ Tháng 1 (index 0) đến Tháng 11 (index 10)
        // Để chừa tháng 12 lại cho bạn test hoặc dùng script khôi phục riêng
        for (let month = 0; month <= 10; month++) {
            const daysInMonth = new Date(YEAR, month + 1, 0).getDate();
            console.log(`Processing Month ${month + 1}/${YEAR}...`);

            // ==========================================
            // 1. THU NHẬP (INCOME)
            // ==========================================
            
            // Lương cứng (salary) - Ngày 5
            const salaryDate = new Date(YEAR, month, 5);
            transactions.push({
                user: USER_ID,
                type: 'income',
                category: 'salary', // Key chuẩn
                amount: roundAmount(getRandomInt(25000000, 32000000)),
                currency: 'VND',
                exchangeRate: 1,
                date: setRandomTime(salaryDate),
                note: `Lương tháng ${month + 1}`,
            });

            // Thưởng/Làm thêm (bonus) - Ngẫu nhiên
            if (Math.random() > 0.6) {
                const bonusDate = new Date(YEAR, month, getRandomInt(15, 25));
                transactions.push({
                    user: USER_ID,
                    type: 'income',
                    category: 'bonus', // Key chuẩn
                    amount: roundAmount(getRandomInt(2000000, 8000000)),
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(bonusDate),
                    note: 'Thưởng dự án / Freelance',
                });
            }

            // Đầu tư sinh lời (investment) - Ít khi xảy ra
            if (Math.random() > 0.8) {
                transactions.push({
                    user: USER_ID,
                    type: 'income',
                    category: 'investment', // Key chuẩn
                    amount: roundAmount(getRandomInt(500000, 1500000)),
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 28)),
                    note: 'Lãi tiết kiệm / Chứng khoán',
                });
            }

            // ==========================================
            // 2. CHI PHÍ CỐ ĐỊNH (FIXED EXPENSE)
            // ==========================================

            // Tiền thuê nhà (rent) - Ngày 1
            const rentDate = new Date(YEAR, month, 1);
            transactions.push({
                user: USER_ID,
                type: 'expense',
                category: 'rent', // Key chuẩn
                amount: 6000000, 
                currency: 'VND',
                exchangeRate: 1,
                date: setRandomTime(rentDate),
                note: 'Tiền nhà tháng này',
            });

            // Tiện ích/Điện nước (housing) - Ngày 10
            // Dùng 'housing' cho các hóa đơn gia đình
            const billDate = new Date(YEAR, month, 10);
            transactions.push({
                user: USER_ID,
                type: 'expense',
                category: 'housing', // Key chuẩn
                amount: roundAmount(getRandomInt(800000, 1500000)),
                currency: 'VND',
                exchangeRate: 1,
                date: setRandomTime(billDate),
                note: 'Điện nước, Internet, Phí dịch vụ',
            });

            // ==========================================
            // 3. CHI TIÊU HÀNG NGÀY (DAILY EXPENSE)
            // ==========================================
            for (let day = 1; day <= daysInMonth; day++) {
                const currentDate = new Date(YEAR, month, day);

                // Ăn uống (food) - Hầu như ngày nào cũng có
                if (Math.random() > 0.1) {
                    transactions.push({
                        user: USER_ID,
                        type: 'expense',
                        category: 'food', // Key chuẩn
                        amount: roundAmount(getRandomInt(40000, 150000)),
                        currency: 'VND',
                        exchangeRate: 1,
                        date: setRandomTime(new Date(currentDate)),
                        note: Math.random() > 0.7 ? 'Ăn hàng' : 'Đi chợ / Cơm trưa',
                    });
                }

                // Di chuyển (transportation) - Xăng xe, Grab
                if (Math.random() > 0.6) {
                    transactions.push({
                        user: USER_ID,
                        type: 'expense',
                        category: 'transportation', // Key chuẩn
                        amount: roundAmount(getRandomInt(30000, 100000)),
                        currency: 'VND',
                        exchangeRate: 1,
                        date: setRandomTime(new Date(currentDate)),
                        note: 'Xăng xe / Grab',
                    });
                }

                // Giải trí (entertainment) - Cuối tuần hoặc ngẫu nhiên
                if (day % 7 === 0 || Math.random() > 0.85) {
                    transactions.push({
                        user: USER_ID,
                        type: 'expense',
                        category: 'entertainment', // Key chuẩn
                        amount: roundAmount(getRandomInt(200000, 800000)),
                        currency: 'VND',
                        exchangeRate: 1,
                        date: setRandomTime(new Date(currentDate)),
                        note: 'Xem phim / Cafe / Game',
                    });
                }
            }

            // ==========================================
            // 4. SỰ KIỆN ĐẶC BIỆT & CÁC KHOẢN KHÁC
            // ==========================================

            // Tháng 1 (Tết): Mua sắm (shopping)
            if (month === 0) {
                transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'shopping', // Key chuẩn
                    amount: 12000000,
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 20)),
                    note: 'Sắm đồ Tết',
                });
                 // Lì xì (dùng 'other' hoặc 'bonus' nhưng là chi) - Dùng 'other' hợp lý hơn
                 transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'other', 
                    amount: 5000000,
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 24)), // Giao thừa
                    note: 'Lì xì Tết',
                });
            }

            // Tháng 5 (Hè): Du lịch (travel)
            if (month === 4) {
                transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'travel', // Key chuẩn
                    amount: 8500000,
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 30)),
                    note: 'Du lịch nghỉ lễ 30/4',
                });
            }

            // Tháng 8 (Tựu trường/Học thêm): Giáo dục (education)
            if (month === 7) {
                transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'education', // Key chuẩn
                    amount: 4000000,
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 15)),
                    note: 'Đóng học phí khóa Tiếng Anh',
                });
            }

            // Tháng 11 (Black Friday): Mua sắm (shopping)
            if (month === 10) {
                transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'shopping', // Key chuẩn
                    amount: 6000000,
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, 11)),
                    note: 'Săn sale 11.11',
                });
            }

            // Sức khỏe (health) - Thỉnh thoảng ốm đau
            if (Math.random() > 0.8) {
                transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'health', // Key chuẩn
                    amount: roundAmount(getRandomInt(200000, 1000000)),
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(YEAR, month, getRandomInt(1, 28))),
                    note: 'Mua thuốc / Khám bệnh',
                });
            }
        }

        // ==========================================
        // 5. CLEANUP & INSERT
        // ==========================================
        
        // Chỉ xóa dữ liệu từ tháng 1 đến tháng 11 (để giữ lại tháng 12 nếu bạn đã seed trước đó)
        const deleteStart = new Date(YEAR, 0, 1);
        const deleteEnd = new Date(YEAR, 11, 1); // Đến đầu tháng 12 (không xóa tháng 12)

        console.log(`🧹 Đang xóa dữ liệu cũ từ ${deleteStart.toLocaleDateString()} đến ${deleteEnd.toLocaleDateString()}...`);
        
        await Transaction.deleteMany({
            user: USER_ID,
            date: { $gte: deleteStart, $lt: deleteEnd }
        });

        console.log(`🌱 Đang insert ${transactions.length} giao dịch...`);
        await Transaction.insertMany(transactions);

        console.log("🎉 SEEDING HOÀN TẤT! Dữ liệu đã khớp với categoryList.");
        process.exit(0);

    } catch (error) {
        console.error("❌ Lỗi Seeding:", error);
        process.exit(1);
    }
};

seedTransactions();