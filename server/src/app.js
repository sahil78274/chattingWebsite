import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import ApiError from './utils/ApiError.js';
import { optionalAuth } from './middleware/auth.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { getConfig } from './controllers/userController.js';
import { readAvatar } from './services/media.js';
import logger from './utils/logger.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false
    })
  );

  const allowedOrigins = new Set(config.cors.origins);
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        // Allow the sandbox preview proxy hosts in non-production environments.
        if (!config.isProd && /^https:\/\/[a-z0-9-]+\.(e2b\.app|arena\.ai)$/i.test(origin)) {
          return callback(null, true);
        }
        logger.warn('Blocked CORS origin', { origin });
        return callback(
          ApiError.forbidden('This origin is not allowed to access the API', { code: 'CORS_BLOCKED' })
        );
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600
    })
  );

  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(optionalAuth);

  app.use('/uploads', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const id = decodeURIComponent(String(req.path || '').replace(/^\//, ''));
    if (!id || id.includes('/') || id.includes('\\')) return next();
    readAvatar(id)
      .then((file) => {
        if (!file) return next();
        res.setHeader('Content-Type', file.mimeType);
        if (req.method === 'HEAD') return res.end();
        return res.end(file.buffer);
      })
      .catch(next);
  });
  app.use(
    '/uploads',
    express.static(config.uploads.dir, { maxAge: '1d', index: false, fallthrough: true })
  );

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      driver: config.db.driver,
      time: new Date().toISOString()
    });
  });

  app.get('/api/config', getConfig);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
