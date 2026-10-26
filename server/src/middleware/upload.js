import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);

fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

export const avatarUpload = multer({
  storage,
  limits: { fileSize: config.limits.avatarMaxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPEG, PNG, WebP or GIF images are allowed', { code: 'BAD_FILE_TYPE' }));
    }
    return cb(null, true);
  }
}).single('avatar');

export function uploadMiddleware(req, res, next) {
  avatarUpload(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          ApiError.badRequest(
            `Profile picture must be smaller than ${Math.round(config.limits.avatarMaxBytes / (1024 * 1024))}MB`,
            { code: 'FILE_TOO_LARGE' }
          )
        );
      }
      return next(error);
    }
    return next();
  });
}

export function removeUploadedFile(file) {
  if (!file?.filename) return;
  const target = path.join(config.uploads.dir, path.basename(file.filename));
  fs.promises.unlink(target).catch(() => {});
}

export default uploadMiddleware;
