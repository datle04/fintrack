import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { deleteBudget, getMonthlyBudget, setOrUpdateBudget } from "../controllers/budget.controller";
import { logActivity } from "../middlewares/logActivity";

const router = Router();

router.use(requireAuth);
router.use(logActivity);

router.post('/', setOrUpdateBudget);
router.get('/', getMonthlyBudget);
router.delete('/', deleteBudget);

export default router;

