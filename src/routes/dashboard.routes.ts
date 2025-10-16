import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { getDashboardByMonths, getDashboardStats } from '../controllers/dashboard.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getDashboardStats);
router.get('/by-months', getDashboardByMonths);

export default router;