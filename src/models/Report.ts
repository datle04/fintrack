import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reportId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true }, 
  filePath: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now }
});

export const ReportModel = mongoose.model('Report', reportSchema);
