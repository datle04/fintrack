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

  originalAmount: number; 
  originalCurrency: string;
   
  totalAmount: number;
  currency: string; 
  exchangeRate: number; 

  categories: CategoryBudget[]; 
  alertLevel: number;
}

const BudgetSchema = new Schema<IBudget>({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },

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

BudgetSchema.index({ user: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model<IBudget>('Budget', BudgetSchema);
