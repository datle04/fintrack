import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getCategoryStats, getSpendingForecast, getTrendStats } from "../controllers/stat.controller";

const router = Router();

router.get('/category-stats', requireAuth, getCategoryStats);   
router.get('/trend-stats', requireAuth, getTrendStats);
router.get('/forecast', requireAuth, getSpendingForecast);

export default router;