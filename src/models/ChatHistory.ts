// src/models/ChatHistory.ts
import { timeStamp } from "console";
import mongoose, { Schema, Document } from "mongoose";

export interface IChatHistory extends Document {
  user: mongoose.Types.ObjectId;
  messages: { role: "user" | "bot"; text: string; createdAt?: Date }[];
}

const chatHistorySchema = new Schema<IChatHistory>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  messages: [
    {
      role: { type: String, enum: ["user", "bot"], required: true },
      text: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, {timestamps: true});

export default mongoose.model<IChatHistory>("ChatHistory", chatHistorySchema);
