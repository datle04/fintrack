// src/models/Goal.ts

import mongoose, { Document, Schema } from 'mongoose';

// 1. Định nghĩa Type cho Status để code chặt chẽ hơn
export type GoalStatus = 'in_progress' | 'completed' | 'failed';

export interface IGoal extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    targetDate: Date;
    description?: string;
    
    // Giữ lại để tương thích ngược, nhưng logic chính sẽ theo status
    isCompleted: boolean; 
    
    createdAt: Date;
    updatedAt: Date;
    targetOriginalAmount: number;
    targetCurrency: string;
    targetBaseAmount: number;
    currentBaseAmount: number;
    creationExchangeRate: number;
    
    // 2. Thêm trường status mới
    status: GoalStatus;
}

const GoalSchema: Schema = new Schema(
    {
        userId: { 
            type: Schema.Types.ObjectId, 
            ref: 'User', 
            required: true 
        },
        name: { 
            type: String, 
            required: true, 
            trim: true 
        },
        targetOriginalAmount: {
            type: Number,
            required: true,
            min: 0
        },
        targetCurrency:{
            type: String,
            required: true,
            default: "VND"
        },
        targetBaseAmount:{
            type: Number,
            required: true
        },
        currentBaseAmount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        creationExchangeRate: { 
            type: Number, 
            default: 1 
        },
        targetDate: { 
            type: Date, 
            required: true 
        },
        description: { 
            type: String 
        },
        isCompleted: { 
            type: Boolean, 
            default: false 
        },
        // 3. Cấu hình Schema cho status
        status: {
            type: String,
            enum: ["in_progress", "completed", "failed"],
            default: "in_progress",
            required: true
        }
    },
    { 
        timestamps: true 
    }
);

// 4. Middleware (Hook) để đồng bộ hóa status và isCompleted
// Mỗi khi lưu Goal, code này sẽ chạy để đảm bảo dữ liệu nhất quán
GoalSchema.pre<IGoal>('save', function (next) {
    // Nếu status là 'completed', set isCompleted = true
    if (this.status === 'completed') {
        this.isCompleted = true;
    } else {
        // Nếu in_progress hoặc failed, set isCompleted = false
        this.isCompleted = false;
    }
    next();
});

const Goal = mongoose.model<IGoal>('Goal', GoalSchema);
export default Goal;