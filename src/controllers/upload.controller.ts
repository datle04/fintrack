import { Request, Response } from 'express';
import cloudinary from '../utils/cloudinary';
import { v4 as uuid } from 'uuid';

export const uploadReceiptImages = async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({ message: "Không có file đính kèm!" });
        return;
    }

    const uploadPromises = files.map((file) => {
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      return cloudinary.uploader.upload(base64, {
        folder: 'fintrack_receipts',
        public_id: `receipt-${uuid()}`,
      });
    });

    const results = await Promise.all(uploadPromises);
    const urls = results.map(result => result.secure_url);

    res.json({ urls });
  } catch (error) {
    console.error('❌ Lỗi upload:', error);
    res.status(500).json({ message: "Upload thất bại!", error });
  }
};
