// src/routes/goal.routes.ts

import { Router } from 'express';
import { createGoal, deleteGoal, getGoals, updateGoal } from '../controllers/goal.controller';
// Giả định requireAuth tồn tại trong src/middlewares/requireAuth
import { requireAuth } from '../middlewares/requireAuth'; 
import validate from '../middlewares/validate';
import { createGoalSchema, updateGoalSchema } from '../validations/goal.validation';

const goalRouter = Router();

goalRouter.use(requireAuth); // Sử dụng middleware bảo vệ

goalRouter.route('/')
    .post(validate(createGoalSchema), createGoal)
    .get(getGoals);

goalRouter.route('/:id')
    .put(validate(updateGoalSchema), updateGoal)
    .delete(deleteGoal);

export default goalRouter;