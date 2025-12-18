import { Router } from 'express';
import { createGoal, deleteGoal, getGoals, updateGoal } from '../controllers/goal.controller';
import { requireAuth } from '../middlewares/requireAuth'; 
import validate from '../middlewares/validate';
import { createGoalSchema, updateGoalSchema } from '../validations/goal.validation';

const goalRouter = Router();

goalRouter.use(requireAuth);

goalRouter.route('/')
    .post(validate(createGoalSchema), createGoal)
    .get(getGoals);

goalRouter.route('/:id')
    .patch(validate(updateGoalSchema), updateGoal)
    .delete(deleteGoal);

export default goalRouter;