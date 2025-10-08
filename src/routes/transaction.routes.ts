import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { createTransaction, deleteTransaction, getCategorySuggestion, getTransactions, getTransactionsByMonth, getUsedCategories, updateTransaction } from "../controllers/transaction.controller";
import upload from "../middlewares/upload";
import { logActivity } from "../middlewares/logActivity";
import axios from 'axios';

const router = Router();

router.use(requireAuth);
router.use(logActivity);

router.post(
  '/',
  requireAuth,
  upload.array('receiptImages', 5),  
  createTransaction
);
router.get('/', getTransactions);
router.get('/by-month', getTransactionsByMonth);
router.put('/:id', upload.array('receiptImages', 5), updateTransaction);
router.delete('/:id', deleteTransaction);
router.get('/categories/used', getUsedCategories);
router.post("/categories/suggestion", async (req, res): Promise<any> => {
  try {
    let { note } = req.body;

    // Gọi API Google Translate: vừa detect vừa translate nếu cần
    const translateRes = await axios.get(
      `https://translate.googleapis.com/translate_a/single`,
      {
        params: {
          client: "gtx",
          sl: "auto", // tự detect
          tl: "en", // dịch sang tiếng Anh
          dt: "t",
          q: note,
        },
      }
    );

    // Google trả về cấu trúc: [[[ "translated", "original", ... ]], ...]
    const translated = translateRes.data[0][0][0];
    const detectedLang = translateRes.data[2];

    // Gửi sang service ML
    const mlRes = await axios.post("http://localhost:8000/predict", {
      text: translated,
    });
    const category = mlRes.data.category;

    res.json({
      category,
      detectedLang,
      originalNote: note,
      translatedNote: translated,
    });
  } catch (err) {
    console.error("Error in /categories/suggestion:", err);
    res.status(500).json({ error: "Prediction failed" });
  }
});


export default router;