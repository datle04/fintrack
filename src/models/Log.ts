import mongoose, { Document, Schema, Types } from "mongoose";

export interface ILog extends Document {
  userId?: string;
  action: string;
  method: string;
  endpoint: string;
  statusCode: number;
  description: String;
  level: "info" | "warning" | "error" | "critical";
  user?: Types.ObjectId;
  timestamp: Date;
}

const LogSchema = new Schema<ILog>({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  action: String,
  method: String,
  endpoint: String,
  statusCode: Number,
  description: String,
  level: { type: String, enum: ["info", "warning", "error", "critical"], default: "info" },

  // --- SỬA LỖI Ở ĐÂY ---
  // Tên trường là 'user' (dựa theo file logAction.ts của bạn)
  // Bạn cần thêm "ref: 'User'" để populate hoạt động.
  user: {
    type: Schema.Types.ObjectId,
    ref: "User", // <-- THÊM DÒNG NÀY
    index: true,
  },
  timestamp: { type: Date, default: Date.now, expires: '30d' }, 
});

export default mongoose.model<ILog>("Log", LogSchema);
