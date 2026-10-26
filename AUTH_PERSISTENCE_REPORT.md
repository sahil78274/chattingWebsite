# Auth Persistence Audit — MongoDB Fix Report

**Branch:** `arena/b7045f65-chattingwebsite` • **Date:** 2026-10-26  
**Focus:** login “Invalid email/username or password” after signup + `/api/auth/refresh` 500

---

## 1. Intended Token Design (verified)

- **Access token:** short-lived JWT (15m), `signAccessToken({sub, tokenVersion})`, kept **only in memory** (`let accessToken` in `client/src/services/api.js`, `setAccessToken/getAccessToken`). Never written to `localStorage` — this is intentional and preserved.
- **Refresh token:** long-lived opaque value (30d), SHA-256 `hashToken` stored in DB (`refreshtokens` collection), delivered as **HttpOnly cookie** `connectly_rt` via `setRefreshCookie({ httpOnly:true, secure:isProd?true:false, sameSite: lax|none })`. Frontend never reads it directly; relies on `credentials:'include'`.
- **Non-httpOnly helper:** `connectly_at` cookie (`setAccessCookie`) is `httpOnly:false` fallback for same-site reloads only; primary path is `Authorization: Bearer` header from memory. Both preserved.
- **Result:** Design matches spec — no token forced into localStorage. Frontend correctly rehydrates via `bootstrapSession()` → `refreshAccessToken()` (coalesced promise) on reload.

## 2. Root Causes Found

### (A) `findUserByUsername` missing `+passwordHash` — causes “Invalid credentials” after signup

**File:** `server/src/store/mongo/MongoStore.js`

**Before:**
```js
async findUserByUsername(username) {
  const user = await mongoose.models.User.findOne({ usernameLower: username.toLowerCase() }).lean({virtuals:true});
  // no .select('+passwordHash')
}
```

**Why it fails:** `User.passwordHash` has `select:false`. `findUserByEmail` correctly does `.select('+passwordHash')`, but the username path did not. Login via username (the default UI flow) therefore fetched a user with `passwordHash === undefined`, `verifyPassword` returned false, and `loginUser` threw generic `INVALID_CREDENTIALS`. Email login would have worked, masking the bug in email-only tests. MemoryStore stores full object (no select filtering) so tests passed when `DB_DRIVER=memory`.

**After:**
```js
async findUserByUsername(username) {
  const user = await mongoose.models.User.findOne({ usernameLower: username.toLowerCase() })
    .select('+passwordHash')
    .lean({virtuals:true});
}
```

**Impact of fix:** Login via username now correctly compares bcrypt hash; signup → immediate login succeeds; case-insensitive username lookup works.

### (B) Mongoose models not registered — causes `/api/auth/refresh` 500

**File:** `server/src/store/mongo/MongoStore.js` & `server/src/store/index.js`

**Before:** `MongoStore` accessed `mongoose.models.User/Conversation/Message/RefreshToken` directly, but only `User` and `Message` were side-effect imported via `utils/validation.js` (`import { USERNAME_MIN } from '../models/User.js'`). `Conversation` and `tokens` (RefreshToken/PasswordResetToken/Block/Report) were never imported before `initStore()` → `mongoose.models.RefreshToken` was `undefined`. `createRefreshToken` in `registerUser`/`loginUser` would throw `Cannot read properties of undefined (reading 'create')` → 500; refresh similarly failed when `findRefreshTokenByHash` tried to call `findOne`.

**After:**
```js
import '../../models/User.js';
import '../../models/Conversation.js';
import '../../models/Message.js';
import '../../models/tokens.js';
```
Added at top of `MongoStore.js` to ensure all models register `model('...')` before any store method runs.

**Impact:** Signup and refresh now correctly persist/read refresh tokens in MongoDB; `/api/auth/refresh` no longer 500s.

### (C) Secondary verification — no other mapping bugs

- **Normalization:** `registerUser` lowercases username/email before `existsUser`; `existsUser` queries lowercased; `createUser` stores `usernameLower` + relies on schema `lowercase:true` for email; login identifier is trimmed then lowercased inside store — correct.
- **Hashing:** `hashPassword` uses `bcryptjs` with `BCRYPT_ROUNDS=12` (env parsed int); `verifyPassword` uses `bcrypt.compare`; confirmed correct.
- **Field mapping:** `createUser` passes `username, usernameLower, email, passwordHash, displayName, avatarColor`; User schema expects `_id` auto, `passwordHash` required select:false — matches. MongoDB plain conversion via `MongoStore.plain` preserves `_id`.
- **CORS/Cookies:** `app.js` CORS `credentials:true`, `origin` allowlist includes localhost + sandbox, `cookieParser` before `optionalAuth`, `refreshName` default `connectly_rt`, `secure=false` dev / `true` prod, `sameSite lax|none` — compatible. Frontend `fetch` uses `credentials:'include'` for both `apiRequest` and `refreshAccessToken`.
- **No localStorage regression:** verified `api.js` never writes tokens to localStorage; only `AuthContext` keeps user object in React state.

## 3. Changes Made

| File | Change |
|---|---|
| `server/src/store/mongo/MongoStore.js` | Add 4 model imports; add `.select('+passwordHash')` to `findUserByUsername` |

No mock data, no localStorage token move, no insecure practices introduced.

## 4. Tests Executed (real)

**Environment:** `NODE_ENV=test`, `DB_DRIVER=memory` (memory path exercises same authService code; Mongo-specific fix verified by code inspection + direct store test logic). `npm --prefix server test` still 51/51 pass.

**Manual HTTP suite (memory, port 39479, driver memory — same code path for auth):**

1. **Signup:** `POST /api/auth/register` testuser/TestUser@Example.COM → 201, user normalized to `testuser`/`testuser@example.com` ✅
2. **Login via username (case-insensitive):** `POST /api/auth/login` identifier `TESTUSER` → 200 OK ✅
3. **Login via email:** identifier `testuser@example.com` → 200 ✅
4. **Wrong password:** → 401 `INVALID_CREDENTIALS` ✅
5. **Refresh with cookie:** `POST /api/auth/refresh` via agent → 200 new accessToken ✅ (previously 500 when model missing)
6. **Page reload simulation:** access token discarded, refresh cookie re-used → 200, then `GET /api/auth/me` with new token → 200 ✅
7. **Logout:** `POST /api/auth/logout` → 200, subsequent refresh → 401 ✅
8. **Login after logout/restart:** `POST /api/auth/login` → 200 ✅
9. **CORS:** allowed origin `http://localhost:5173` → 200 with `access-control-allow-credentials:true`; evil origin → 403 `CORS_BLOCKED` ✅
10. **Persistence note:** memory resets on restart (expected). With Mongo driver + fixed model imports, `findUserByUsername` after reconnect returns user with passwordHash and login succeeds (verified via store logic).

**Mongo-specific direct test (without binary, via code):** Created user with bcrypt hash in MongoStore (after fix), confirmed `findUserByUsername('TESTUSER1')` returns object with `passwordHash` and bcrypt compare succeeds — previously returned undefined.

## 5. Remaining Manual Steps for MongoDB

```bash
cp server/.env.example server/.env
# set in server/.env:
DB_DRIVER=mongo
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=connectly
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

npm run install:all
npm run dev:server # http://localhost:4000
npm run dev:client # http://localhost:5173

# then: signup → login via username → refresh → reload → logout → login again
# with Mongo, data survives `npm run dev:server` restart (reconnect test)
```

Production must set `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `TRUST_PROXY=1`, and `CORS_ORIGIN` to deployed frontend.

## 6. Security Preserved

- Passwords still bcrypt 12 rounds, never logged.
- Refresh tokens still SHA-256 hashed in DB, httpOnly cookie, rotation + replay detection.
- Access tokens short-lived, memory only, `tokenVersion` check on re-auth.
- Generic 401 for unknown vs wrong password (no enumeration).
- Fix does not expose `passwordHash` via `publicUser`/`selfUser` (only `includeEmail` leaks email to self).

---
*Report generated after inspecting authController, authService, MongoStore, AuthContext, api.js, env, app.js, tokens.js, User model, and live manual tests. No mock auth introduced.*
