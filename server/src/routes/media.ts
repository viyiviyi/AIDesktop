import { Router, Request, Response } from 'express';
import { APPS_DATA_DIR, ensureDir } from '../utils/file.js';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';

const router = Router();

// Multer setup: memory storage so we can validate file type before writing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, GIF, WebP, SVG`));
    }
  },
});

/**
 * Get the media directory for an app
 */
function getMediaDir(appId: string): string {
  return path.join(APPS_DATA_DIR, appId, 'media');
}

/**
 * Convert a filename to a URL path
 */
function toUrl(appId: string, filename: string): string {
  return `/api/files/${appId}/media/${filename}`;
}

/**
 * Scan the media directory and return sorted lists of icons and backgrounds.
 * Files are sorted by name alphabetically (oldest first based on timestamp in filename).
 */
async function scanMedia(appId: string): Promise<{ icons: string[]; backgrounds: string[] }> {
  const mediaDir = getMediaDir(appId);
  const files = await fs.readdir(mediaDir).catch(() => []);

  const icons: string[] = [];
  const backgrounds: string[] = [];

  for (const file of files) {
    if (file.startsWith('icon_') && (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.gif') || file.endsWith('.webp') || file.endsWith('.svg'))) {
      icons.push(toUrl(appId, file));
    } else if (file.startsWith('bg_') && (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.gif') || file.endsWith('.webp') || file.endsWith('.svg'))) {
      backgrounds.push(toUrl(appId, file));
    }
  }

  // Sort by filename (which contains timestamp, oldest first)
  icons.sort();
  backgrounds.sort();

  return { icons, backgrounds };
}

/**
 * Enforce maxFiles limit per type. If more than maxFiles exist, delete the oldest ones.
 */
async function enforceLimit(mediaDir: string, type: string, maxFiles: number): Promise<void> {
  const prefix = type === 'icon' ? 'icon_' : 'bg_';
  const files = await fs.readdir(mediaDir).catch(() => []);
  const typeFiles = files
    .filter(f => f.startsWith(prefix))
    .map(f => ({ name: f, fullPath: path.join(mediaDir, f) }));

  if (typeFiles.length > maxFiles) {
    // Sort by name (timestamp in filename) to determine age
    typeFiles.sort((a, b) => a.name.localeCompare(b.name));

    // Delete oldest ones (first N in sorted order)
    const toDelete = typeFiles.slice(0, typeFiles.length - maxFiles);
    for (const file of toDelete) {
      await fs.rm(file.fullPath, { force: true });
    }
  }
}

// POST /api/apps/:appId/media — Upload media file
router.post('/:appId/media', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { type } = req.body;

    if (!type || (type !== 'icon' && type !== 'background')) {
      return res.status(400).json({ error: 'type must be "icon" or "background"' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mediaDir = getMediaDir(appId);
    await ensureDir(mediaDir);

    // Determine extension from original file
    const ext = path.extname(req.file.originalname) || '.png';
    const timestamp = Date.now();
    const typePrefix = type === 'icon' ? 'icon' : 'bg';
    const filename = `${typePrefix}_${timestamp}${ext}`;
    const filePath = path.join(mediaDir, filename);

    // Write file
    await fs.writeFile(filePath, req.file.buffer);

    // Enforce max 10 files per type
    await enforceLimit(mediaDir, type === 'icon' ? 'icon' : 'bg', 10);

    // Get updated lists
    const { icons, backgrounds } = await scanMedia(appId);

    res.json({
      url: toUrl(appId, filename),
      allIcons: icons,
      allBackgrounds: backgrounds,
    });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max size is 10MB.' });
      }
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/apps/:appId/media — List media files
router.get('/:appId/media', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { icons, backgrounds } = await scanMedia(appId);

    res.json({ icons, backgrounds });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// DELETE /api/apps/:appId/media — Delete a specific media file
router.delete('/:appId/media', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required in request body' });
    }

    // Extract filename from URL: /api/files/{appId}/media/{filename}
    const prefix = `/api/files/${appId}/media/`;
    if (!url.startsWith(prefix)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const filename = url.slice(prefix.length);
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const mediaDir = getMediaDir(appId);
    const filePath = path.join(mediaDir, filename);

    await fs.rm(filePath, { force: true });

    // Get updated lists
    const { icons, backgrounds } = await scanMedia(appId);

    res.json({
      success: true,
      allIcons: icons,
      allBackgrounds: backgrounds,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
