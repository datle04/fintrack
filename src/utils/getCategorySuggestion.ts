import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const getCategorySuggestion = async (note: string) => {
  const prompt = `
  Phân loại giao dịch tài chính cá nhân dựa trên mô tả sau:
  "${note}"

  Hãy chọn 1 danh mục phù hợp nhất trong các nhóm sau:
  - sales
  - transportation
  - education
  - entertainment
  - shopping
  - housing
  - health
  - rent
  - bonus
  - salary
  - food
  - investment
  - travel
  - other

  Trả về kết quả ngắn gọn: chỉ tên danh mục (ví dụ: sales).
  `;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const text = result.response.text().trim().toLowerCase();

  const categories = [
    "sales",
    "transportation",
    "education",
    "entertainment",
    "shopping",
    "housing",
    "health",
    "rent",
    "bonus",
    "salary",
    "food",
    "investment",
    "travel",
    "other",
  ];

  const matched = categories.find((cat) => text.includes(cat)) || "other";
  return matched;
};
