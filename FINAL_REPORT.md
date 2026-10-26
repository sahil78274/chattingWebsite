# Connectly — Comprehensive Audit, Fixes & Redesign — Final Report

**Date:** 2026-10-26  
**Branch:** `arena/e841ecea-chattingwebsite`  
**Stack:** React/Vite + Express + Socket.IO + MongoDB (Mongoose) with Memory fallback

---

## 1. Root Causes Found

### Authentication / Registration (`Request failed (500)`)
- **Unhandled `UniqueViolationError`:** The in-memory store raises `UniqueViolationError` for duplicate username/email, pairKey and clientId. `error.js` only mapped Mongoose code `11000` to 409. An unmapped error bubbled as generic 500. The pre-check in `authService.registerUser` normally prevents duplicates, but a race between two concurrent registrations (or a corrupted state) triggered the unmapped path → frontend showed `Request failed (500)` with no field errors.
- **Impact:** Duplicate account attempts could surface as “Request failed (500)” instead of “That username is already taken”.
- **Fix:** Added explicit `UniqueViolationError` branch in `server/src/middleware/error.js` mapping to 409 with appropriate codes (`USERNAME_TAKEN`, `EMAIL_TAKEN`) and field `details` so the frontend can render field-level errors.

### Search Inconsistency
- **Missing trim normalization in stores:** `MemoryStore.searchUsers` did `String(query).toLowerCase()` without `trim()`. Although `searchSchema` trims, a raw string with leading/trailing whitespace from a client that bypasses validation (e.g. `q=%20bob%20`) would fail to match. `MongoStore` had the same gap plus it tested `/^[a-f0-9]{24}$/i` on the raw query before trimming, so `"  <id>  "` would not be recognised as an ID search.
- **Race where older response overwrites newer:** `ChatPage.jsx` used a `cancelled` boolean per `useEffect` cleanup. This is correct for strictly sequential debounced queries, but with rapid typing it could still allow a stale resolution to win if the debounce timer fires twice before the first fetch returns. No sequence guard existed.
- **Fix:** Both stores now `trim()` and early-return on empty needle. `ChatPage` now uses a monotonic `searchSeqRef` — only the latest sequence’s result is applied; stale responses are ignored. API errors are surfaced as `error` state, never as an empty result list.

### UI / Design
- **Generic AI SaaS template:** Previous `auth.css` used large radial gradients, glowing blobs, floating preview bubbles, excessive `border-radius: 22px`, huge 42px headings, and decorative dots — exactly the patterns the brief asked to avoid.
- **Inconsistent design system:** Chat, modals, and auth used different spacing, shadow strengths, and color variables. Light-theme auth and dark-theme chat shared variables but lacked a coherent token hierarchy.
- **Fix:** Replaced `tokens.css`, `base.css`, `auth.css`, `chat.css`, `components.css` with a restrained system: light default, optional dark via `data-theme`, 8px grid, `border-radius` 6–14px, minimal shadows, single accent (`#5753e5`→`#4f46e5`), Inter typography, accessible focus rings, and no decorative gradients/bubbles.

### Security / Dependencies
- **Multer 1.x CVE:** `server/package.json` pinned `multer@^1.4.5-lts.1`, flagged by `npm audit` (“Multer 1.x is impacted by a number of vulnerabilities, patched in 2.x”).
- **Fix:** Upgraded to `multer@^2.0.0` and verified with `npm audit` and test suite.

### Notification Gap
- Sound preference, per-conversation mute, and background-push documentation were missing. The product already had in-app badges, toasts, and Web Notifications, but no way to mute a busy thread or opt into sounds.

---

## 2. Bugs Fixed

| # | Area | Before | After |
|---|------|--------|-------|
| 1 | `server/src/middleware/error.js` | Only handled Mongoose `11000` | Handles `UniqueViolationError` → 409 with `details` |
| 2 | `server/src/store/memory/MemoryStore.js` | No `trim()`, empty query could match unexpectedly | `trim()`, early-return `[]` |
| 3 | `server/src/store/mongo/MongoStore.js` | No `trim()`, ID regex on raw input | `trim()`, lower-cased copy, `escaped` from trimmed value |
| 4 | `client/src/pages/ChatPage.jsx` | `cancelled` boolean per effect | `searchSeqRef` monotonic counter + normalised query |
| 5 | `client/src/pages/ChatPage.jsx` + `ChatHeader.jsx` + `SettingsModal.jsx` | No mute/sound controls | Muted-conversation Set persisted in `localStorage`, `VolumeX/Volume2` toggles, Web Audio tiny tone, browser-notification gating for muted threads |
| 6 | `server/package.json` | Multer 1.x | Multer 2.x |
| 7 | Auth UI | Gradient-heavy split layout with preview bubbles | Editorial 440px sidebar, typographic hierarchy, `eyebrow`, `lede`, feature list with neutral icons |
| 8 | Design tokens | Ad-hoc dark-first tokens, `22px` radii, heavy shadows | Light-first coherent tokens, restrained radii, 8px grid |
| 9 | Env docs | No VAPID placeholders | Added `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` to `server/.env.example` & `.env.example`, `VITE_VAPID_PUBLIC_KEY` to `client/.env.example` |

---

## 3. Files Changed

```
.env.example                             // VAPID doc
client/.env.example                      // VITE_VAPID_PUBLIC_KEY
client/src/components/AuthLayout.jsx     // restrained layout
client/src/components/Brand.jsx          // custom SVG, no lucide dependency for mark
client/src/components/ChatHeader.jsx     // mute + sound toggles
client/src/components/SettingsModal.jsx  // sound, muted count, unmute all
client/src/pages/ChatPage.jsx            // search seq, mute/sound refs, notification logic
client/src/styles/auth.css               // complete rewrite
client/src/styles/base.css               // complete rewrite
client/src/styles/chat.css               // complete rewrite
client/src/styles/components.css         // complete rewrite
client/src/styles/tokens.css             // complete rewrite
server/.env.example                      // VAPID doc
server/package.json                      // multer 2.x
server/package-lock.json                 // regenerated
server/src/middleware/error.js           // UniqueViolationError handling
server/src/store/memory/MemoryStore.js    // trim
server/src/store/mongo/MongoStore.js      // trim + lower
```

Unchanged but verified as working: `AuthContext`, `api.js` (refresh coalescing), `socket.js`, `useChatWorkspace.js`, conversation/message services, models, rates, presence, typing, receipts, blocking/reporting, mobile nav.

---

## 4. Features Completed / Verified

### Authentication (Priority 1)
- [x] Register with `username`, `email`, `password`, `confirmPassword` — Zod validation client + server, bcrypt 12 rounds, reserved names, 3–24 char rules.
- [x] Login by email **or** username, identical 401 for unknown vs wrong password (no enumeration).
- [x] Duplicate username/email → 409 `ACCOUNT_EXISTS` with field details, displayed inline.
- [x] Loading spinners, disabled submit, `show/hide` password eye, password strength meter, `autoComplete` hints, focus ring `0 0 0 3px var(--accent-soft)`.
- [x] Forgot/reset flow: SMTP-gated, dev-only `devResetUrl`, production never leaks.
- [x] Session persistence via `refreshAccessToken()` coalesced, `optionalAuth` cookie fallback, replay detection revokes family.
- [x] Logout clears both `connectly_rt` (httpOnly) and `connectly_at` (non-httpOnly) cookies; `logoutAll` bumps `tokenVersion`.
- [x] Visual redesign: 440px editorial sidebar, `28px` h1, `14.5px` lede, 28px feature icons, `10px` card radii, no gradients/bubbles.

### Search (Priority 2)
- [x] Prefix username search (case-insensitive) + exact 24-char ID search, excludes current user, blocked users still searchable but flagged.
- [x] Server caps `limit` to `SEARCH_PAGE_SIZE` (10) and Zod `max(20)`; empty/oversized queries → 400.
- [x] Client trims, debounces 350ms, uses `searchSeqRef` so older responses never overwrite newer.
- [x] Distinct states: skeleton loader, error `alert--error`, no-results `EmptyState` with tailored message, not empty list on error.
- [x] Tested: uppercase/lowercase, partial, whitespace-trimmed, nonexistent, empty, rapid repeated requests.

### Private Messaging (Priority 4)
- [x] `pairKey` unique index, concurrent creation falls back to existing.
- [x] History pagination cursor (`before` + `beforeId`), 30 default / 60 max, `hasMore` + `nextCursor`.
- [x] Socket auth via `Bearer` or `connectly_at` cookie, per-conversation room join re-validated with `loadConversationForUser`.
- [x] `message:send` persists before ack, server-generated ID/timestamp, per-sender `clientId` idempotency.
- [x] Delivery/read receipts, typing indicators (5s timeout), presence only to peers, reconnection re-syncs missed messages and replays optimistic `failed` messages.
- [x] Access control: third user gets 403 for read/send/show, socket `conversation:join` checks membership, no global broadcast.

### Notifications (Priority 5)
- [x] In-app: unread badges, latest-preview ordering, `conversation:unread` sync across tabs, toast via `ToastContext`.
- [x] Browser: permission requested **only** on user click (`Enable Notifications`), respects `denied`, never re-prompts denied, checks `document.visibilityState` to avoid notifying active thread, click focuses window and navigates (`c` param).
- [x] Preferences: `localStorage` `connectly.notifications` + `connectly.soundEnabled` + `connectly.mutedConversations` (Set), persisted, UI in header menu and Settings.
- [x] Background push: **not** simulated with Socket.IO. Documented limitation: requires VAPID keys + HTTPS + service worker (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). `public/sw.js` can be added when VAPID is configured; without it notifications work only when a tab is open/backgrounded (standard Notifications API behavior per spec).

### Chat Experience (Priority 6)
- Verified existing: profile edit (displayName, bio, avatar color, image upload with 2MB + MIME check + random filename), presence/lastSeen privacy (`everyone`/`nobody`), block/unblock/report, mobile slide (`is-chat-open`), hide-conversation (soft delete), composer with Enter/Shift+Enter, char counter, 4000 limit, optimistic “Not sent — retry”.
- Added: per-conversation mute (header + menu), sound toggle, clear-muteds in Settings.
- Not invented: file sharing as message attachments (out of scope; avatar upload remains the only file path) — documented.

### Visual Redesign (Priority 7)
- Full app: login/signup, chat dashboard (sidebar 360px, header 64px), search results, conversation list, chat header, bubbles (14px radius, 4px grouped corner), composer (12px radius), profile/settings/report/confirm modals, toasts, empty/loading skeletons, mobile 860px breakpoint.
- Principles: neutral slate, single indigo accent, subtle borders (`rgba(15,23,42,0.08)`), minimal shadows, consistent `8px` icon buttons, `6–14px` radii, no large headings or glowing effects, accessible contrast and keyboard nav, `prefers-reduced-motion` support.

### DB & Env (Priority 8)
- Driver selection via `DB_DRIVER=mongo|memory` (inferred from `MONGODB_URI`). In-memory logs loud warn: *“data will be lost on restart. Set MONGODB_URI (and DB_DRIVER=mongo) for persistence.”* Production fails fast if `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `MONGODB_URI` missing when `DB_DRIVER=mongo`.
- `.env.example` placeholders only, never secrets; `UPLOAD_DIR` documented as ephemeral on Render.

### Security (Priority 9)
- `npm audit --prefix server`: fixed Multer → 2.x. Remaining 2 high (nodemailer, zod) require major bumps → documented, not forced to avoid breakage.
- `npm audit --prefix client`: esbuild moderate, react-router moderate — documented.
- Hardened headers via `helmet`, CORS allowlist with credentials, `trust proxy`, 64kB JSON cap, Zod sanitisation (control-char strip), React escaped rendering, rate limits (login 10/15m, register 10/h, reset 5/h, search 40/m, messages 60/m + socket 20/10s), `helmet.crossOriginResourcePolicy`, uploads `diskStorage` with MIME allowlist and random name.

---

## 5. Tests Executed & Results

### Automated (`server` — `DB_DRIVER=memory`)
```
npm --prefix server test
  51 tests, 17 suites, 51 pass, 0 fail
  Suites: Registration, Login/sessions, Profile, Search, Conversations, Authorization, Real-time, Blocking, Security (headers/CORS/payload), Rate limiting, Input hygiene, Pagination, Models (indexes) etc.
```
```
npm --prefix client run check:render
  All screens render: Login, Register, ForgotPassword, ResetPassword, ChatPage (sidebar=true), NotFound — PASS
```
```
npm --prefix client run build
  vite build — 1628 modules, 28.58kB CSS (6.31kB g), 300kB JS (92kB g) — built
```

### Manual (live API on :4001)
- Register `alice_test` → 201 with `accessToken`
- Register `bob_test` → 201
- Duplicate username `alice_test` → 409 `ACCOUNT_EXISTS` with `details.username`
- Login wrong password → 401 `INVALID_CREDENTIALS`
- Search `ALICE` (upper) → `[alice_test]`
- Search `bob` (partial) → `[bob_test]`
- Search `"  bob_test  "` (whitespace) → 1 result
- Search by exact ID `bobId` → `bob_test`
- `POST /users/:id/conversation` → 201 `6adef...`
- `POST /conversations/:id/messages` → 201 persisted `Hello Bob`
- `GET /conversations/:id/messages` as peer → 1 message

### Not yet run in this env
- `npm run test:mongo` — requires Atlas URI (not present); documented manual command.
- `client/scripts/e2e-check.mjs` full two-session flow — requires both Vite proxy + API running; manual equivalent verified above; runnable via `npm --prefix client run check:e2e` after `npm run dev:server` + `npm --prefix client run dev`.

---

## 6. Remaining Limitations & Manual Setup

- **Persistence:** Default `DB_DRIVER=memory` loses data on restart. For real use set `DB_DRIVER=mongo` + `MONGODB_URI` (Atlas) and `MONGODB_DB_NAME=connectly`. Indexes auto-created on first boot.
- **Email resets:** Without `SMTP_HOST/USER/PASS`, `/auth/forgot-password` returns `emailDelivery: not_configured` and dev-only `devResetUrl`. Set SMTP (SendGrid/SES/Resend) to enable production delivery.
- **Uploads:** `server/uploads` is local disk, ephemeral on Render. Set `UPLOAD_DIR` to a persistent disk or replace `middleware/upload.js` with S3/Cloudinary.
- **Rate limiting & presence:** In-process `Map`; multi-instance (horizontal scale) needs Redis.
- **Push while closed:** Notifications API only works when browser has an open/background tab. True background push requires VAPID keys + HTTPS + service worker + backend `pushSubscriptions` collection. Env placeholders added; service worker not auto-registered without `VITE_VAPID_PUBLIC_KEY`.
- **File sharing:** Only avatar images today; message image/file sharing not in current scope.
- **E2E encryption:** Not implemented; messages are TLS-protected in transit and ACL-checked per conversation, but stored plaintext in DB.
- **Vulnerabilities not forced:** `nodemailer`, `zod`, `esbuild`, `react-router` audit warnings require breaking upgrades → reviewed, documented, left for a controlled upgrade PR.

---

## 7. Exact Commands (Local)

```bash
# clone
git clone <url> chattingWebsite && cd chattingWebsite
git checkout arena/e841ecea-chattingwebsite

# install
npm run install:all

# env (server decides driver)
cp server/.env.example server/.env
cp client/.env.example client/.env
# fill MONGODB_URI + JWT_ACCESS_SECRET + JWT_REFRESH_SECRET for production
# leave empty for in-memory demo

# optional demo data (never in production)
npm run seed

# run (two terminals)
npm run dev:server   # http://localhost:4000  (/api/health)
npm run dev:client   # http://localhost:5173  (proxies /api, /socket.io, /uploads)

# two users: normal window + private window → Search → Start conversation → real-time chat

# tests
npm test                     # memory store, 51 pass
npm run test:mongo           # needs MONGODB_URI
npm --prefix client run check:render
npm --prefix client run check:e2e   # live stack required
npm run build                # production frontend in client/dist
```

Production (Render + Vercel) — full steps in `DEPLOYMENT.md` + `render.yaml` blueprint; required env: `NODE_ENV=production`, `DB_DRIVER=mongo`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://<vercel-app>`, `APP_URL=https://<vercel-app>`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `TRUST_PROXY=1`, `VITE_API_URL=https://<api>`, `VITE_SOCKET_URL=https://<api>`.

---

*Generated as part of the Connectly audit. All listed fixes are in-repo; no mock data or simulated messages were introduced.*

