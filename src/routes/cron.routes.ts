// // POST /api/admin/run-cron (chỉ ví dụ)
// import { Request, Response, Router } from 'express';
// import { runRecurringTransactions } from '../cron/recurringJob';
// import { requireAuth } from '../middlewares/requireAuth';

// const router = Router();

// router.use(requireAuth);

// export const manualRunCron = async (req: Request, res: Response) => {
//   try {
//     await runRecurringTransactions();
//     res.status(200).json({ message: "Cron đã chạy xong" });
//   } catch (error) {
//     res.status(500).json({ message: "Lỗi", error });
//   }
// }

// router.get('/', manualRunCron);

// export default router;