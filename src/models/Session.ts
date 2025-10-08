import mongoose from "mongoose";

export interface SessionDocument extends Document {
    userId: mongoose.Types.ObjectId;
    loginAt: Date;
    logoutAt: Date;
    duration: number;
}


const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  loginAt: { type: Date, required: true },
  logoutAt: { type: Date },
  duration: { type: Number }, 
});

export const SessionModel = mongoose.model("Session", sessionSchema);
