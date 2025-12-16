import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { cancelRecurringByKeyword, cancelRecurringTransaction, createTransaction, deleteLastTransaction, deleteTransaction, getActiveRecurringTransactions, getTopTransactions, getTransactions, getTransactionsByMonth, getUsedCategories, triggerRecurringTest, updateTransaction } from "../controllers/transaction.controller";
import upload from "../middlewares/upload";
import { logActivity } from "../middlewares/logActivity";
import axios from 'axios';
import { getCategorySuggestion } from "../utils/getCategorySuggestion";
import validate from "../middlewares/validate";
import { createTransactionSchema, updateTransactionSchema } from "../validations/transaction.validation";

const router = Router();

router.use(requireAuth);
router.use(logActivity);

router.post(
  '/',
  validate(createTransactionSchema),
  upload.array('receiptImages', 5),  
  createTransaction
);
router.get('/', getTransactions);
router.get('/by-month', getTransactionsByMonth);
router.patch('/:id', validate(updateTransactionSchema), upload.array('receiptImages', 5), updateTransaction);
router.delete('/last-transaction', deleteLastTransaction);
router.delete("/recurring/by-keyword", cancelRecurringByKeyword);
router.delete('/:id', deleteTransaction);
router.get('/categories/used', getUsedCategories);
router.get('/recurring', getActiveRecurringTransactions);
router.delete("/recurring/:id", cancelRecurringTransaction);
router.get('/top-transactions', getTopTransactions);

export default router;