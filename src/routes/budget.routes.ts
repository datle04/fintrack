import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { deleteBudget, getMonthlyBudget, setOrUpdateBudget } from "../controllers/budget.controller";
import { logActivity } from "../middlewares/logActivity";
import validate from "../middlewares/validate";
import { createBudgetSchema } from "../validations/budget.validation";

const router = Router();

router.use(requireAuth);
router.use(logActivity);

router.post('/', validate(createBudgetSchema), setOrUpdateBudget);
router.get('/', getMonthlyBudget);
router.delete('/', deleteBudget);

export default router;

