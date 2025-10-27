import mongoose, { Schema, Document } from 'mongoose';

interface CategoryBudget {
  category: string;
  originalAmount: number;
  amount: number;
  alertLevel?: number;
}

export interface IBudget extends Document {
  user: mongoose.Types.ObjectId;
  month: number;
  year: number;

  // TRƯỜNG HIỂN THỊ GỐC (NEW)
  originalAmount: number; // Số tiền gốc người dùng nhập (Ví dụ: 100)
  originalCurrency: string; // Đơn vị tiền tệ gốc (Ví dụ: 'USD')
   
  // TRƯỜNG TÍNH TOÁN CHUẨN (BASE CURRENCY)
  totalAmount: number; // Tổng ngân sách đã quy đổi về VND
  currency: string; // Luôn là 'VND'
  exchangeRate: number; // Luôn là 1

  categories: CategoryBudget[]; 
  alertLevel: number;
}

const BudgetSchema = new Schema<IBudget>({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },

  // 💡 TRƯỜNG MỚI: Dùng để HIỂN THỊ
  originalAmount: { type: Number, required: true, default: 0 },
  originalCurrency: { type: String, required: true, default: 'VND' },

  totalAmount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'VND' },
  exchangeRate: { type: Number, required: true, default: 1 },

  categories: [
    {
      category: { type: String, required: true },
      originalAmount: { type: Number, required: true, default: 0 },
      amount: { type: Number, required: true }, 
      alertLevel: { type: Number, default: 0 }
    }
  ],
  alertLevel: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model<IBudget>('Budget', BudgetSchema);
