import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// POST /validate-dir — 校验目录是否存在
router.post('/validate-dir', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath || typeof dirPath !== 'string') {
      return res.json({ exists: false, error: '请提供目录路径' });
    }
    const absDir = path.resolve(dirPath);
    const exists = fs.existsSync(absDir) && fs.statSync(absDir).isDirectory();
    res.json({ exists, error: exists ? undefined : `目录不存在: ${absDir}` });
  } catch (error) {
    res.status(500).json({ exists: false, error: (error as Error).message });
  }
});

export default router;
