import mongoose, { Document, Schema } from 'mongoose';

export type GoalStatus = 'in_progress' | 'completed' | 'failed';

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

GoalSchema.pre<IGoal>('save', function (next) {
    if (this.status === 'completed') {
        this.isCompleted = true;
    } else {
        this.isCompleted = false;
    }
    next();
});

GoalSchema.index({ userId: 1, status: 1 });   
GoalSchema.index({ userId: 1, targetDate: 1 });

const Goal = mongoose.model<IGoal>('Goal', GoalSchema);
export default Goal;