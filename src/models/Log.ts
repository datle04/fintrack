import mongoose, { Document, Schema } from "mongoose";

export interface ILog extends Document {
  userId?: string;
  action: string;
  method: string;
  endpoint: string;
  statusCode: number;
  description: String;
  level: "info" | "warning" | "error" | "critical";
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
  timestamp: { type: Date, default: Date.now, expires: '30d' }, 
});

export default mongoose.model<ILog>("Log", LogSchema);
