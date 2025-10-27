// src/models/Goal.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface IGoal extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    targetDate: Date;
    description?: string;
    isCompleted: boolean;
    createdAt: Date;
    updatedAt: Date;
    targetOriginalAmount: number;
    targetCurrency: string;
    targetBaseAmount: number;
    currentBaseAmount: number;
    creationExchangeRate: number;
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
    },
    { 
        timestamps: true 
    }
);

const Goal = mongoose.model<IGoal>('Goal', GoalSchema);
export default Goal;