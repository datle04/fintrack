import express from "express";
import { getFinancialHealth } from "../controllers/analytics.controller";
import { requireAuth } from "../middlewares/requireAuth";

const router = express.Router();
router.get("/health", requireAuth, getFinancialHealth); // GET /api/analytics/health
export default router;