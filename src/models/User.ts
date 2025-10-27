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
  isBanned: { type: Boolean, default: false }
}

const UserSchema = new Schema<IUser>(
    {
        name: { type: String, required: true},
        email: {type: String, required: true},
        password: {type: String, required: true},
        avatarUrl: {type: String, default: ""},
        dob: {type: String, required: false},
        phone: {type: String, required: false},
        address: {type: String, required: false},
        currency: {type: String, default: "VND"},
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user'
        },
        isBanned: {type: Boolean, default: false}
    },
    {timestamps: true}  
)

export default mongoose.model<IUser>("User", UserSchema);