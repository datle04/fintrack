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
import * as GoalController from '../controllers/admin/goal.controller';
import * as BudgetController from '../controllers/admin/budget.controller';
import { logActivity } from "../middlewares/logActivity";
import upload from "../middlewares/upload";
import Budget from "../models/Budget";

const router = express.Router();

router.use(requireAuth, checkAdmin);
router.use(logActivity);

// User management
router.get("/users", UserController.getAllUsers);
router.put("/users/:userId", UserController.updateUserInfo);
router.delete("/users/:userId", UserController.deleteUser);
router.patch("/users/:userId/ban", UserController.banUser);
router.patch("/users/:userId/unban", UserController.unbanUser);

// Transaction management
router.get("/transactions", TransactionController.getAllTransactions);
router.delete("/transactions/:id", TransactionController.deleteTransaction);
router.get("/transactions/stats", TransactionController.getTransactionStats);
router.put("/transactions/:id", upload.array('receiptImages', 5) ,TransactionController.adminUpdateTransaction);

// Budget
router.get('/budget', BudgetController.getAllBudgets);
router.get('/budget/:budgetId', BudgetController.getBudgetById);
router.put('/budget/:budgetId', BudgetController.adminUpdateBudget);
router.delete('/budget/:budgetId', BudgetController.adminDeleteBudget);

// Dashboard
router.get("/dashboard", DashboardController.getAdminDashboardStats);
router.get('/dashboard/monthly-stats', DashboardController.getMonthlyIncomeExpenseStats);
router.get('/dashboard/monthly-transactions', DashboardController.getMonthlyTransactionCount);
router.get("/dashboard/user-signups", DashboardController.getNewUserSignups);
router.get("/dashboard/recent-errors", DashboardController.getRecentErrorLogs);
router.get("/dashboard/active-users", DashboardController.getActiveUsersStats);
router.get("/dashboard/top-categories", DashboardController.getTopExpenseCategories);

// Report
router.get('/report/:reportId', ReportController.getReportById);
router.get('/report', ReportController.getAllReports);
router.delete('/report/:reportId', ReportController.deleteReport);

// Category
router.get("/categories/summary", CategoryController.getCategorySummary);

// Log
router.get("/logs", LogController.getAllLogs);

// Session
router.get("/session/weekly-duration", SessionController.getWeeklyDurationAllUsers);

// Goal
router.get("/goals", GoalController.getAllGoals);
router.get("/goals/:goalId", GoalController.getGoalById);
router.put("/goals/:goalId", GoalController.adminUpdateGoal);
router.delete("/goals/:goalId", GoalController.adminDeleteGoal);
router.post("/goals/:goalId/recalculate", GoalController.adminRecalculateGoal);

export default router;
