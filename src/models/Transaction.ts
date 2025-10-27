import mongoose, { Document, mongo, ObjectId, Schema } from "mongoose";

export interface ITransaction extends Document {
    user: mongoose.Types.ObjectId;
    type: "income" | "expense";
    amount: number;
    category: string;
    currency: string;
    exchangeRate: number;
    note?: string;
    date: Date;
    receiptImage?: string[];
    isRecurring?: boolean;
    recurringDay?: number; // ví dụ: 15 -> mỗi tháng vào ngày 15
    recurringId?: string; // để nhóm các recurring lại
    goalId: mongoose.Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const transactionSchema = new Schema<ITransaction> (
    {
        user: {type: Schema.Types.ObjectId, ref: "User", required: true},
        type: {type: String, enum: ["income", "expense"], required: true},
        amount: {type: Number, required: true},
        category: { type: String, required: true},
        currency: { 
            type: String, 
            required: true, 
            default: 'VND' // Đơn vị tiền tệ của giao dịch (ví dụ: USD, EUR)
        },
        exchangeRate: { 
            type: Number, 
            required: true, 
            default: 1 // Tỷ giá quy đổi về đơn vị tiền tệ gốc (Base Currency)
        },
        note: {type: String, required: false},
        date: {type: Date, required: false},
        receiptImage: {type: [String], required: false},
        isRecurring: {type: Boolean, default: false},
        recurringDay: { type: Number, min: 1, max: 31 },
        recurringId: { type: String }, // dùng để track recurring serie
        goalId: {
            type:mongoose.Schema.Types.ObjectId,
            ref: 'Goal',
            default: null
        }
    },
    {timestamps: true}
);

// Thêm index để query nhanh theo user + date
transactionSchema.index({ user: 1, date: -1 });


export default mongoose.model<ITransaction>("Transaction", transactionSchema);
