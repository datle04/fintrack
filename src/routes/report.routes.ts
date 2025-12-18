import express from 'express';
import { generatePDF } from '../utils/pupeteer';
import { exportReport } from '../controllers/report.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { logActivity } from '../middlewares/logActivity';

const router = express.Router();
router.use(logActivity);

router.post('/export', requireAuth, exportReport);


export default router;
