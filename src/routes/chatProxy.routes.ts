
import express from "express";
import { requireAuth } from '../middlewares/requireAuth';
import { chatProxy } from "../controllers/chatProxy.controller";

const router = express.Router();

router.post('/', requireAuth, chatProxy);

export default router;