import mongoose, { Schema, Document, Types } from "mongoose";

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
  
  // 👇 THÊM DÒNG NÀY
  // Dùng 'any' hoặc 'Record<string, any>' để linh hoạt lưu object
  metadata?: any; 
}

const LogSchema = new Schema<ILog>({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  action: String,
  method: String,
  endpoint: String,
  statusCode: Number,
  description: String,
  level: { type: String, enum: ["info", "warning", "error", "critical"], default: "info" },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true,
  },
  
  // 👇 THÊM DÒNG NÀY
  // Schema.Types.Mixed cho phép lưu object JSON tùy ý
  metadata: { type: Schema.Types.Mixed }, 

  timestamp: { type: Date, default: Date.now, expires: '30d' }, 
});

const Log = mongoose.model<ILog>("Log", LogSchema);
export default Log;