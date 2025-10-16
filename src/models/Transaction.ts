import mongoose, { Document, mongo, Schema } from "mongoose";

export interface ITransaction extends Document {
    user: mongoose.Types.ObjectId;
    type: "income" | "expense";
    amount: number;
    category: string;
    note?: string;
    date: Date;
    receiptImage?: string[];
    isRecurring?: boolean;
    recurringDay?: number; // ví dụ: 15 -> mỗi tháng vào ngày 15
    recurringId?: string; // để nhóm các recurring lại
    createdAt?: Date;
    updatedAt?: Date;
}

const transactionSchema = new Schema<ITransaction> (
    {
        user: {type: Schema.Types.ObjectId, ref: "User", required: true},
        type: {type: String, enum: ["income", "expense"], required: true},
        amount: {type: Number, required: true},
        category: { type: String, required: true},
        note: {type: String, required: false},
        date: {type: Date, required: false},
        receiptImage: {type: [String], required: false},
        isRecurring: {type: Boolean, default: false},
        recurringDay: { type: Number, min: 1, max: 31 },
        recurringId: { type: String }, // dùng để track recurring serie
    },
    {timestamps: true}
);

// Thêm index để query nhanh theo user + date
transactionSchema.index({ user: 1, date: -1 });


export default mongoose.model<ITransaction>("Transaction", transactionSchema);
