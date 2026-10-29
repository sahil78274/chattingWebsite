import multer from 'multer';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.avatarMaxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(
        ApiError.badRequest('Only JPEG, PNG, WebP or GIF images are allowed', { code: 'BAD_FILE_TYPE' })
      );
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

export default uploadMiddleware;
