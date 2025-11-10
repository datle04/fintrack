import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getUserInfo, updateProfile } from "../controllers/user.controller";
import upload from "../middlewares/upload";
import { logActivity } from "../middlewares/logActivity";

const router = Router();
router.use(logActivity);

router.get('/me', requireAuth, getUserInfo);
router.put('/profile', requireAuth, upload.single("avatar"), updateProfile);

export default router;