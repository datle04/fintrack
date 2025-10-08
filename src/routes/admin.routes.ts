import express from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { checkAdmin } from "../middlewares/checkAdmin";
import * as UserController from "../controllers/admin/user.controller";
import * as TransactionController from "../controllers/admin/transaction.controller";
import * as ReportController from '../controllers/admin/report.controller';
import * as DashboardController from '../controllers/admin/dashboard.controller';
import * as CategoryController from '../controllers/admin/category.controller';
import * as LogController from '../controllers/admin/log.controller';
import * as SessionController from '../controllers/admin/session.controller';
import { logActivity } from "../middlewares/logActivity";
import upload from "../middlewares/upload";

const router = express.Router();

router.use(requireAuth, checkAdmin);
router.use(logActivity);

// User management
router.get("/users", UserController.getAllUsers);
router.put("/users/:userId", UserController.updateUserInfo);
router.delete("/users/:userId", UserController.deleteUser);
router.patch("/users/:userId", UserController.banUser);

// Transaction management
router.get("/transactions", TransactionController.getAllTransactions);
router.delete("/transactions/:id", TransactionController.deleteTransaction);
router.get("/transactions/stats", TransactionController.getTransactionStats);
router.put("/transactions/:id", upload.array('receiptImages', 5) ,TransactionController.adminUpdateTransaction);

// Dashboard
router.get("/dashboard", DashboardController.getAdminDashboardStats);
router.get('/dashboard/monthly-stats', DashboardController.getMonthlyIncomeExpenseStats);
router.get('/dashboard/monthly-transactions', DashboardController.getMonthlyTransactionCount);

// Category
router.get("/categories/summary", CategoryController.getCategorySummary);

// Log
router.get("/logs", LogController.getLogs);

// Session
router.get("/session/weekly-duration", SessionController.getWeeklyDurationAllUsers);

export default router;
