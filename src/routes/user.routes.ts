import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getUserInfo, updateProfile } from "../controllers/user.controller";
import upload from "../middlewares/upload";
import { logActivity } from "../middlewares/logActivity";
import validate from "../middlewares/validate";
import { updateProfileSchema } from "../validations/auth.validation";

const router = Router();
router.use(logActivity);

router.get('/me', requireAuth, getUserInfo);
router.patch( 
  "/profile",
  requireAuth,
  upload.single("avatar"), 
  validate(updateProfileSchema), 
  updateProfile 
);

export default router;