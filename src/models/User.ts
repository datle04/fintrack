import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  _id: string; 
  name: string;
  email: string;
  password: string;
  role: "user" | "admin"; 
  currency: string;
  avatarUrl?: string;
  dob?: string;
  phone?: string;
  address?: string;
  isBanned: boolean; 
  refreshToken?: string;
  otp?: string;
  otpExpires?: Date;
}

const UserSchema = new Schema<IUser>(
    {
        name: { type: String, required: true },
        email: { 
            type: String, 
            required: true, 
            unique: true, 
            trim: true,   
            lowercase: true 
        },
        password: { type: String, required: true },
        avatarUrl: { type: String, default: "" },
        dob: { type: String, required: false },
        phone: { type: String, required: false },
        address: { type: String, required: false },
        currency: { type: String, default: "VND" },
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user',
            index: true 
        },
        isBanned: { type: Boolean, default: false },

        refreshToken: { type: String, index: true }, 
        
        otp: { type: String, select: false },
        otpExpires: { type: Date, select: false }
    },
    { timestamps: true }  
)

UserSchema.index({ name: 'text', email: 'text' });

export default mongoose.model<IUser>("User", UserSchema);