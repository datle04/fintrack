import mongoose from 'mongoose';
// ⚠️ Thay thế bằng đường dẫn thực tế của Transaction model và server setup của bạn
import Transaction from '../models/Transaction'; 

// Giả định bạn có biến môi trường cho MongoDB URL
const MONGODB_URL = process.env.MONGODB_URI!;

/**
 * Script migration: Cập nhật các giao dịch cũ không có trường currency và exchangeRate.
 */
const migrateCurrencyFields = async () => {
    console.log("🚀 Bắt đầu migration: Cập nhật trường tiền tệ cho giao dịch cũ...");

    try {
        // 1. Kết nối MongoDB
        await mongoose.connect(MONGODB_URL);
        console.log("   ✅ Kết nối MongoDB thành công.");

        // 2. Thực hiện cập nhật hàng loạt
        const result = await Transaction.updateMany(
            // Điều kiện: Tìm tất cả các documents mà trường 'currency' hoặc 'exchangeRate' không tồn tại
            {
                $or: [
                    { currency: { $exists: false } },
                    { exchangeRate: { $exists: false } }
                ]
            },
            // Cập nhật: Đặt giá trị mặc định là 'VND' và 1
            {
                $set: {
                    currency: 'VND',
                    exchangeRate: 1
                }
            }
        );

        console.log(`   ✨ Hoàn tất Migration!`);
        console.log(`   - Số lượng tài liệu tìm thấy: ${result.matchedCount}`);
        console.log(`   - Số lượng tài liệu được cập nhật: ${result.modifiedCount}`);

    } catch (error) {
        console.error("❌ Lỗi xảy ra trong quá trình Migration:", error);
    } finally {
        // 3. Ngắt kết nối MongoDB
        await mongoose.disconnect();
        console.log("   🔌 Ngắt kết nối MongoDB.");
    }
};

// Chạy script
migrateCurrencyFields();