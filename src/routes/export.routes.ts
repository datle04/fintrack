// routes/pdf.ts
import express from "express";
import { generatePDF } from "../utils/pupeteer";
import { Request, Response } from "express";
import { logActivity } from "../middlewares/logActivity";
import { exportReport } from "../controllers/report.controller";

const router = express.Router();
router.use(logActivity);

router.post("/generate", exportReport);

export default router;
