// src/routes/goal.routes.ts

import { Router } from 'express';
import { createGoal, deleteGoal, getGoals, updateGoal } from '../controllers/goal.controller';
// Giả định requireAuth tồn tại trong src/middlewares/requireAuth
import { requireAuth } from '../middlewares/requireAuth'; 

const goalRouter = Router();

goalRouter.use(requireAuth); // Sử dụng middleware bảo vệ

goalRouter.route('/')
    .post(createGoal)
    .get(getGoals);

goalRouter.route('/:id')
    .put(updateGoal)
    .delete(deleteGoal);

export default goalRouter;