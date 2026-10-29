# Connectly — deployment guide

Frontend on **Vercel**, API + Socket.IO on **Render**, database on **MongoDB Atlas**.
Any Node host works the same way (Fly.io, Railway, Hetzner, a VPS with PM2 + Nginx).

---

## 0. Before you start

1. Three things to prepare:
   - a MongoDB Atlas cluster with a database user and network access (see README §5),
   - two long random secrets: `openssl rand -hex 48` (run twice),
   - the git repository pushed to GitHub.
2. Decide your URLs:
   - frontend: `https://connectly.vercel.app` (custom domains work too),
   - API: `https://connectly-api.onrender.com`.
3. HTTPS is mandatory in production: secure refresh cookies and WSS need it.

---

## 1. Deploy the API (Render)

### Option A — blueprint (recommended)

`render.yaml` in the repo root defines the service. In Render: **New → Blueprint**, pick the repo,
then fill in the env vars marked `sync: false`:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority` |
| `MONGODB_DB_NAME` | `connectly` |
| `JWT_ACCESS_SECRET` | first random secret |
| `JWT_REFRESH_SECRET` | second random secret |
| `CORS_ORIGIN` | `https://connectly.vercel.app` |
| `APP_URL` | `https://connectly.vercel.app` |

### Option B — manual

1. **New → Web Service**, connect the repo.
2. Root directory: `server` · Runtime: Node · Build: `npm install` · Start: `npm start`.
3. Health check path: `/api/health`.
4. Environment:

```env
NODE_ENV=production
DB_DRIVER=mongo
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=connectly
JWT_ACCESS_SECRET=<48-byte hex>
JWT_REFRESH_SECRET=<48-byte hex>
CORS_ORIGIN=https://connectly.vercel.app
APP_URL=https://connectly.vercel.app
COOKIE_SECURE=true
COOKIE_SAMESITE=none
TRUST_PROXY=1
BRAND_NAME=Connectly
```

Render sets `PORT` automatically — do not hard-code it.

5. Deploy, then check:

```bash
curl https://connectly-api.onrender.com/api/health
# {"ok":true,"uptime":3,"driver":"mongo","time":"..."}
```

`driver` must be `mongo`. If it says `memory`, `MONGODB_URI` is missing and data will not persist.

### Persistent uploads
`server/uploads` is ephemeral on Render. Avatars are stored in this order:

1. **S3-compatible object storage** when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set
   (Cloudflare R2, AWS S3, MinIO). Also set `S3_PUBLIC_BASE_URL` so the SPA can load the image.
2. **MongoDB GridFS** (`avatars` bucket) when the API is connected to Atlas — no extra service required.
3. Local disk (`UPLOAD_DIR`) for development only.

Never put object-storage keys in `VITE_*` variables.

### First administrator (`ADMIN_EMAIL`)

1. Register the intended administrator through the normal signup form
   (`https://<your-app>/register`) if the account does not already exist.
2. Render → `connectly-api` → **Environment** → add:
   ```
   ADMIN_EMAIL=your-admin-email@gmail.com
   ```
   Use the exact email of that account. Never put a password here.
3. Deploy / restart the API. The bootstrap runs once at process start
   (`server/src/index.js` → `bootstrapAdmin`), so a restart is sufficient — no rebuild needed.
4. Check the Render **Logs** for one of:
   - `Bootstrapped administrator from environment` with `via: "ADMIN_EMAIL"` → success.
   - `Admin bootstrap skipped: no account is registered with the configured administrator email` → the
     email does not match a registered account (or differs from it); fix the value and restart.
   - `Admin bootstrap skipped: an active administrator already exists` → someone is already an admin;
     nothing was changed.
   - `Admin bootstrap skipped: the configured account is not active` → the account is suspended.
5. Sign in with that account's existing password and open `/admin`. Only after this works, remove the
   obsolete `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_EMAIL` variables if you set them.

Behaviour: the account is promoted to `role: admin` only. It is never created automatically, its
password is never changed, and nothing from the browser can influence the target. The bootstrap is
idempotent and runs only while the deployment has no active administrator, so it cannot silently
re-promote a demoted account. Existing administrators are never overwritten or demoted. Do not reset
the database for this step. No database migration is required (Mongoose creates `auditlogs` on first
write).

Legacy variables `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_EMAIL` still work; `ADMIN_EMAIL` takes
precedence when both are present.

### Free plan caveat
Render free instances sleep after inactivity; the first request after sleeping takes ~30 s and open
sockets reconnect automatically. Use a paid instance for a real deployment.

---

## 2. Deploy the frontend (Vercel)

1. **Add New → Project**, import the repo, set **Root Directory** to `client`.
2. Framework preset **Vite**; build `npm run build`; output `dist`.
3. Environment variables (Production **and** Preview):

```env
VITE_API_URL=https://connectly-api.onrender.com
VITE_SOCKET_URL=https://connectly-api.onrender.com
```

> Leave both empty to call the API on the same origin (useful if you proxy `/api` through Vercel
> rewrites or a custom domain). `client/vercel.json` already handles React Router's SPA fallback.

4. Deploy, open the site, register two accounts, and confirm messages arrive in real time.

---

## 3. Post-deploy checklist

- [ ] `GET /api/health` returns `"driver":"mongo"`.
- [ ] Registering sets the `connectly_rt` cookie with `HttpOnly`, `Secure`, `SameSite=None`.
- [ ] Two browsers can chat in real time; refresh keeps history.
- [ ] A third account cannot open the conversation URL.
- [ ] Atlas shows the `users`, `conversations`, `messages`, `refreshtokens` collections with indexes.
- [ ] Login rate limiting kicks in after 10 failed attempts.
- [ ] (Optional) Password-reset email arrives when SMTP is configured.
- [ ] `server/uploads` (or object storage) accepts a profile picture under 2 MB.

---

## 4. Scaling notes

| Concern | Current implementation | For multiple instances |
| --- | --- | --- |
| Rate limits | in-memory buckets (`middleware/rateLimit.js`) | move to Redis (`rate-limiter-flexible`) |
| Presence / sockets | in-process `Map` + Socket.IO default adapter | add `@socket.io/redis-adapter` and a shared presence store |
| Sessions | refresh tokens in MongoDB (safe as-is) | – |
| Uploads | local disk | S3/Cloudinary |
| Logs | JSON to stdout | ship to your log platform |

Everything else (validation, authorization, idempotency) is stateless and scales horizontally.

---

## 5. Custom domain & same-site cookies

If you serve the frontend and API under one domain (e.g. `app.example.com` and `api.example.com`
with a shared parent, or `/api` proxied by Vercel), you can use `COOKIE_SAMESITE=lax` and optionally
`COOKIE_DOMAIN=.example.com`. This avoids browser restrictions on third-party cookies.

---

## 6. Rolling back / migrating

- Conversations and messages are plain MongoDB documents — `mongodump`/`mongorestore` or Atlas
  backup works without special handling.
- Indexes are created by Mongoose on boot; a new deployment adds them automatically.
- Rotating `JWT_ACCESS_SECRET` logs everyone out immediately (by design). Rotating
  `JWT_REFRESH_SECRET` is not used for signing (refresh tokens are random), so it is safe to rotate.
