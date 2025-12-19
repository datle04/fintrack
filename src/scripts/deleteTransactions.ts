import mongoose from 'mongoose';
// ⚠️ LƯU Ý: Hãy trỏ đúng đường dẫn đến file Model Transaction của bạn
import Transaction from '../models/Transaction'; 

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const USER_ID = "6933edda5f0184301a4616cb";
const YEAR = 2025;
const MONGO_URI = "mongodb+srv://ldat0909:Letandat31102004@cluster0.3wglbsv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // 🔥 Đổi URI nếu cần

const cleanTransactions = async () => {
    try {
        console.log("🚀 Đang kết nối MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Kết nối thành công!");

        // Logic xác định thời gian:
        // Start: Ngày 1 tháng 1 (Tháng 0 trong JS)
        const startDate = new Date(YEAR, 0, 1); 
        
        // End: Ngày 1 tháng 12 (Tháng 11 trong JS)
        // Dùng toán tử nhỏ hơn ($lt) ngày 1/12 sẽ tự động lấy hết ngày 30/11
        const endDate = new Date(YEAR, 11, 1); 

        console.log(`🧹 Đang tiến hành xóa giao dịch của User: ${USER_ID}`);
        console.log(`📅 Phạm vi: Từ [${startDate.toLocaleDateString()}] đến trước [${endDate.toLocaleDateString()}]`);

        const result = await Transaction.deleteMany({
            user: USER_ID,
            date: {
                $gte: startDate, // Lớn hơn hoặc bằng 1/1
                $lt: endDate     // Nhỏ hơn 1/12 (Tức là lấy hết tháng 11)
            }
        });

        console.log("------------------------------------------------");
        console.log(`✅ ĐÃ HOÀN TẤT!`);
        console.log(`🗑️  Số lượng giao dịch đã xóa: ${result.deletedCount}`);
        console.log("------------------------------------------------");

        process.exit(0);

    } catch (error) {
        console.error("❌ Lỗi khi xóa dữ liệu:", error);
        process.exit(1);
    }
};

cleanTransactions();