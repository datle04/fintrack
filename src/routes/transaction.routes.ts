import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { cancelRecurringTransaction, createTransaction, deleteTransaction, getActiveRecurringTransactions, getTopTransactions, getTransactions, getTransactionsByMonth, getUsedCategories, triggerRecurringTest, updateTransaction } from "../controllers/transaction.controller";
import upload from "../middlewares/upload";
import { logActivity } from "../middlewares/logActivity";
import axios from 'axios';
import { getCategorySuggestion } from "../utils/getCategorySuggestion";

const router = Router();

router.use(requireAuth);
router.use(logActivity);

router.post(
  '/',
  requireAuth,
  upload.array('receiptImages', 5),  
  createTransaction
);
router.get('/', getTransactions);
router.get('/by-month', getTransactionsByMonth);
router.put('/:id', upload.array('receiptImages', 5), updateTransaction);
router.delete('/:id', deleteTransaction);
router.get('/categories/used', getUsedCategories);
router.get('/recurring', getActiveRecurringTransactions);
router.delete("/recurring/:id", cancelRecurringTransaction);
// Route test recurring
router.post("/test-recurring", triggerRecurringTest);
router.get('/top-transactions', getTopTransactions);

export default router;