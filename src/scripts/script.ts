import mongoose from 'mongoose';
import Transaction from '../models/Transaction'; // Trỏ đúng file Model

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const USER_ID = "6933edda5f0184301a4616cb";
const YEAR = 2025;
const MONGO_URI = "mongodb+srv://ldat0909:Letandat31102004@cluster0.3wglbsv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; 

// Hàm random helper
const getRandomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const roundAmount = (amount: number) => Math.ceil(amount / 1000) * 1000;
const setRandomTime = (date: Date) => {
    date.setHours(getRandomInt(8, 22), getRandomInt(0, 59), 0, 0);
    return date;
};

const seedDecember = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        const transactions: any[] = [];
        const month = 11; // Tháng 12 (Index 11)
        const daysInMonth = 31;

        console.log(`🎄 Đang tạo lại dữ liệu Tháng 12/${YEAR}...`);

        // 1. THU NHẬP THÁNG 12 (Lương + Thưởng Tết Tây sớm)
        // Lương
        const salaryDate = new Date(YEAR, month, 5);
        transactions.push({
            user: USER_ID,
            type: 'income',
            category: 'Lương',
            amount: roundAmount(getRandomInt(25000000, 30000000)),
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(salaryDate),
            note: 'Lương tháng 12',
            createdAt: salaryDate, 
            updatedAt: salaryDate
        });

        // Thưởng cuối năm (Year End Bonus) - Ngày 28/12
        const bonusDate = new Date(YEAR, month, 28);
        transactions.push({
            user: USER_ID,
            type: 'income',
            category: 'Thưởng',
            amount: roundAmount(getRandomInt(10000000, 20000000)), // Thưởng 10-20tr
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(bonusDate),
            note: 'Thưởng dự án cuối năm',
        });

        // 2. CHI PHÍ CỐ ĐỊNH THÁNG 12
        transactions.push({
            user: USER_ID,
            type: 'expense',
            category: 'Nhà ở',
            amount: 6000000,
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(new Date(YEAR, month, 1)),
            note: 'Tiền thuê nhà T12',
        });

         transactions.push({
            user: USER_ID,
            type: 'expense',
            category: 'Hóa đơn & Tiện ích',
            amount: roundAmount(getRandomInt(900000, 1200000)),
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(new Date(YEAR, month, 10)),
            note: 'Điện nước T12',
        });

        // 3. CHI TIÊU ĐẶC BIỆT THÁNG 12 (Noel, Tất niên)
        // Mua quà Noel (23/12)
        transactions.push({
            user: USER_ID,
            type: 'expense',
            category: 'Mua sắm',
            amount: roundAmount(getRandomInt(1500000, 3000000)),
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(new Date(YEAR, month, 23)),
            note: 'Mua quà Giáng sinh',
        });

        // Ăn tất niên công ty (27/12) - Tăng ca về muộn gọi Grab
        transactions.push({
            user: USER_ID,
            type: 'expense',
            category: 'Di chuyển',
            amount: 150000,
            currency: 'VND',
            exchangeRate: 1,
            date: setRandomTime(new Date(YEAR, month, 27)),
            note: 'Grab về sau tiệc tất niên',
        });

        // Cafe/Ăn uống hàng ngày
        for (let day = 1; day <= daysInMonth; day++) {
             const currentDate = new Date(YEAR, month, day);
             
             // Cafe sáng (60% số ngày)
             if (Math.random() > 0.4) {
                 transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'Ăn uống',
                    amount: roundAmount(getRandomInt(30000, 60000)),
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(currentDate)),
                    note: 'Cafe',
                });
             }

             // Ăn trưa/tối
             if (Math.random() > 0.2) {
                 transactions.push({
                    user: USER_ID,
                    type: 'expense',
                    category: 'Ăn uống',
                    amount: roundAmount(getRandomInt(40000, 150000)),
                    currency: 'VND',
                    exchangeRate: 1,
                    date: setRandomTime(new Date(currentDate)),
                    note: Math.random() > 0.8 ? 'Ăn sang cuối tuần' : 'Cơm văn phòng',
                });
             }
        }

        // QUAN TRỌNG: Lần này KHÔNG dùng deleteMany toàn bộ nữa
        // Chỉ xóa dữ liệu tháng 12 cũ (nếu có lỡ chạy trùng)
        const startDate = new Date(YEAR, 11, 1);
        const endDate = new Date(YEAR + 1, 0, 1);
        
        await Transaction.deleteMany({
            user: USER_ID,
            date: { $gte: startDate, $lt: endDate }
        });

        await Transaction.insertMany(transactions);

        console.log(`✅ Đã khôi phục/tạo mới ${transactions.length} giao dịch cho tháng 12!`);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

seedDecember();