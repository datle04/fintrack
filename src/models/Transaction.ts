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
    recurringDay?: number; 
    recurringId?: string; 
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
            default: 'VND'
        },
        exchangeRate: { 
            type: Number, 
            required: true, 
            default: 1 
        },
        note: {type: String, required: false},
        date: {type: Date, required: false},
        receiptImage: {type: [String], required: false},
        isRecurring: {type: Boolean, default: false},
        recurringDay: { type: Number, min: 1, max: 31 },
        recurringId: { type: String }, 
        goalId: {
            type:mongoose.Schema.Types.ObjectId,
            ref: 'Goal',
            default: null
        }
    },
    {timestamps: true}
);

// Dashboard chính (Tìm theo ngày)
transactionSchema.index({ user: 1, date: -1 });

// Tính toán Goal (Tìm theo GoalID)
transactionSchema.index({ goalId: 1 });

// Cron Job (Tìm giao dịch định kỳ)
transactionSchema.index({ isRecurring: 1, recurringDay: 1 });

// Filter & Report (Tìm theo loại/danh mục)
transactionSchema.index({ user: 1, category: 1 });
transactionSchema.index({ type: 1 }); 


export default mongoose.model<ITransaction>("Transaction", transactionSchema);
