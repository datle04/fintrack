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
  
  metadata: { type: Schema.Types.Mixed }, 

  timestamp: { type: Date, default: Date.now, expires: '30d' }, 
});

LogSchema.index({ user: 1, timestamp: -1 }); 
LogSchema.index({ level: 1, timestamp: -1 });
LogSchema.index({ action: 1, timestamp: -1 });
LogSchema.index({ statusCode: 1, timestamp: -1 });

const Log = mongoose.model<ILog>("Log", LogSchema);
export default Log;