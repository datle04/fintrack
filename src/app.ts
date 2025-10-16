// app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from "cookie-parser";
import path from 'path';

import authRoutes from './routes/auth.routes';
import transactionRoutes from './routes/transaction.routes';
import dashboardRoutes from './routes/dashboard.routes';
import uploadRoutes from './routes/upload.routes';
import budgetRoutes from './routes/budget.routes';
import userRoutes from './routes/user.routes';
import notificationRoutes from './routes/notification.routes';
import statRoutes from './routes/stat.routes';
import reportRoutes from './routes/report.routes';
import adminRoutes from './routes/admin.routes';
import chatHistoryRoutes from './routes/chatHistory.routes';

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Middleware
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use('/static', express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/transaction', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/upload', uploadRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/user', userRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/stats', statRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat-history', chatHistoryRoutes);

app.get('/', (req, res) => {
    res.send('FinTrack API is running');
});

export default app;
