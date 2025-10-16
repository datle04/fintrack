import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getCategoryStats } from "../controllers/stat.controller";

const router = Router();

router.get('/category-stats', requireAuth, getCategoryStats);   

export default router;