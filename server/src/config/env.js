import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const rawMongoUri = process.env.MONGODB_URI || '';
const dbDriver = (process.env.DB_DRIVER || (rawMongoUri ? 'mongo' : 'memory')).toLowerCase();

const corsOrigins = list(process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173');

const accessSecret =
  process.env.JWT_ACCESS_SECRET || (isProd ? '' : 'dev-only-access-secret-change-me-please');
const refreshSecret =
  process.env.JWT_REFRESH_SECRET || (isProd ? '' : 'dev-only-refresh-secret-change-me-please');

if (isProd) {
  const missing = [];
  if (!accessSecret) missing.push('JWT_ACCESS_SECRET');
  if (!refreshSecret) missing.push('JWT_REFRESH_SECRET');
  if (dbDriver === 'mongo' && !rawMongoUri) missing.push('MONGODB_URI');
  if (dbDriver !== 'mongo' && !bool(process.env.ALLOW_MEMORY_STORE, false)) {
    missing.push('MONGODB_URI (memory store is not allowed in production unless ALLOW_MEMORY_STORE=true)');
  }
  if (missing.length) {
    // Fail fast instead of booting with insecure defaults.
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
}

export const config = {
  nodeEnv: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 4000),
  apiPrefix: '/api',
  brand: {
    name: process.env.BRAND_NAME || 'Connectly',
    tagline: process.env.BRAND_TAGLINE || 'Private conversations, anywhere in India.'
  },
  db: {
    driver: dbDriver === 'mongo' ? 'mongo' : 'memory',
    mongoUri: rawMongoUri,
    mongoDbName: process.env.MONGODB_DB_NAME || undefined,
    // Loads demo accounts on boot. Refused in production (see index.js).
    seedDemo: bool(process.env.SEED_DEMO, false)
  },
  jwt: {
    accessSecret,
    refreshSecret,
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    accessTtlMs: int(process.env.ACCESS_TOKEN_TTL_MS, 15 * 60 * 1000),
    refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30)
  },
  cookies: {
    refreshName: process.env.REFRESH_COOKIE_NAME || 'connectly_rt',
    // SameSite=None + Secure is required for cross-site deployments (Vercel -> Render).
    secure: bool(process.env.COOKIE_SECURE, isProd),
    sameSite: process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax'),
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/'
  },
  cors: {
    origins: corsOrigins
  },
  limits: {
    messageMaxLength: int(process.env.MESSAGE_MAX_LENGTH, 4000),
    avatarMaxBytes: int(process.env.AVATAR_MAX_BYTES, 2 * 1024 * 1024),
    searchPageSize: int(process.env.SEARCH_PAGE_SIZE, 10),
    messagePageSize: int(process.env.MESSAGE_PAGE_SIZE, 30)
  },
  rateLimit: {
    // Disabled automatically under NODE_ENV=test so the suite can register
    // many accounts; individual limiters can still be forced in tests.
    enabled: bool(process.env.RATE_LIMIT_ENABLED, NODE_ENV !== 'test')
  },
  uploads: {
    dir: process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(serverRoot, 'uploads'),
    publicPath: '/uploads'
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Connectly <no-reply@connectly.local>',
    get configured() {
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    }
  },
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  trustProxy: int(process.env.TRUST_PROXY, isProd ? 1 : 0),
  admin: {
    // Canonical first-admin setup: the email of an EXISTING registered account.
    // Server-side only — never exposed through /api/config or any VITE_* var.
    email: process.env.ADMIN_EMAIL || '',
    // Legacy bootstrap variables, still honoured for backwards compatibility.
    bootstrapUsername: process.env.BOOTSTRAP_ADMIN_USERNAME || '',
    bootstrapEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || ''
  },
  s3: {
    bucket: process.env.S3_BUCKET || '',
    accessKey: process.env.S3_ACCESS_KEY_ID || '',
    secretKey: process.env.S3_SECRET_ACCESS_KEY || '',
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || '',
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  },
  allowMemoryStore: bool(process.env.ALLOW_MEMORY_STORE, false)
};

export default config;
