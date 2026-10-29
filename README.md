# Connectly

A complete, working real-time chatting website — React + Vite frontend, Node.js/Express API,
Socket.IO real-time transport and MongoDB (Atlas) persistence.

People can register with a unique username, find each other by username or user ID from anywhere in
India, and chat privately in real time with persistent history, unread counts, delivery/read receipts,
presence, typing indicators, blocking and reporting.

> **Branding:** the brand name lives in two places — `client/src/components/Brand.jsx` (`BRAND_NAME`,
> `BRAND_TAGLINE`) and the `BRAND_NAME` / `BRAND_TAGLINE` environment variables on the server. Change
> those and the whole product is re-branded. No third-party chat API is used; all messaging runs on
> this repository's own backend and Socket.IO.

---

## Table of contents

1. [What works](#1-what-works)
2. [Architecture](#2-architecture)
3. [Project structure](#3-project-structure)
4. [Local setup](#4-local-setup)
5. [MongoDB Atlas setup](#5-mongodb-atlas-setup)
6. [Environment variables](#6-environment-variables)
7. [API reference](#7-api-reference)
8. [Real-time events](#8-real-time-events)
9. [Testing](#9-testing)
10. [Security model](#10-security-model)
11. [Deployment](#11-deployment)
12. [Known limitations & honest verification notes](#12-known-limitations--honest-verification-notes)

---

## 1. What works

### Authentication
- Register with username, email, password + confirm password (validated on the client **and** the server).
- Unique usernames and emails enforced by database unique indexes (case-insensitive).
- Passwords hashed with bcrypt (12 rounds). Plain-text passwords are never stored or logged.
- Login with **email or username**, logout, session persistence across reloads.
- Short-lived JWT access tokens (15 min, memory only) + rotating refresh tokens (30 days) stored as
  SHA-256 hashes in the `refreshtokens` collection and delivered in an **httpOnly cookie**.
- Refresh-token reuse detection: replaying an already-rotated token revokes the whole token family.
- Password change / "sign out of all devices" bumps a `tokenVersion` that invalidates every issued
  access token immediately.
- Forgot / reset password flow (see [email delivery](#email-smtp-for-password-resets)).
- Password visibility toggles and a strength meter on every password field.

### Profiles
- Unique username (case-insensitive), stable user ID, **display names may repeat**, avatar
  (upload or colour), optional bio, account creation date, online status, last seen (privacy setting).
- Editable display name, bio, avatar colour and avatar image upload. Photos are stored in S3 (if
  configured), otherwise MongoDB GridFS, otherwise local disk for development. The client never keeps
  a blob URL as the permanent picture.
- Public profiles never expose emails, password hashes, roles or session data.

### Search
- Search by **partial username** (prefix, case-insensitive) or **exact 24-char user ID**.
- Results show avatar, username, display name and online status.
- Debounced on the client (350 ms), paginated on the server (max 20 per page), rate limited,
  and the logged-in user is always excluded.
- No location permission, GPS or region-locked API: the same global site works for everyone in India.

### Conversations & messages
- One conversation per user pair, guaranteed by a unique `pairKey` index (race-safe, falls back to the
  existing conversation if two requests create it simultaneously).
- Conversation list with latest-message preview, timestamps, ordering and unread counts.
- Real-time one-to-one messaging over authenticated Socket.IO rooms.
- Messages persisted before the sender is acknowledged, server-generated IDs and timestamps.
- History pagination (30 messages per page, cursor based), with "load earlier messages".
- Delivery receipts (`sent → delivered → read`) and read receipts, per message (monotonic, sender-only ticks).
- Message actions: react, reply, copy, edit own, delete for me, delete for everyone (own messages),
  forward, select. Permissions are enforced on the server.
- Emoji reactions persist and sync over Socket.IO.
- Idempotent sends: a client-generated `clientId` is unique per conversation/sender, so retries and
  reconnects can never create duplicates.
- Enter to send, Shift+Enter for a newline, auto-growing composer, character counter, 4000-char limit.
- Optimistic UI with a visible "Not sent — retry" state; unsent messages are replayed automatically on
  reconnect and re-synced from the server so nothing is lost silently.
- Remove (hide) a conversation from your own list without deleting the other person's history.

### Extras (really implemented, not static buttons)
- Typing indicators, online/offline presence, last-seen privacy.
- Dark (`#000000`) and light themes only, FOUC-safe, persisted in localStorage.
- Administrator dashboard (`/admin`, with `/app/admin` kept as a legacy alias) for accounts with
  `role: admin`: live counts, recent registrations, user search/pagination, suspend/reactivate,
  report moderation and an audit log. Bootstrap an existing user with `BOOTSTRAP_ADMIN_USERNAME` or
  `BOOTSTRAP_ADMIN_EMAIL` — there is no hardcoded password, no public admin signup and ordinary users
  cannot promote themselves.
- Browser notifications with explicit permission handling.
- Avatar image upload (local disk on the API by default — see [uploads](#image-uploads)).
- Block / unblock users (server-enforced in both directions) and report a user.

---

## 2. Architecture

```
┌────────────────────────────┐        HTTPS / WSS        ┌──────────────────────────────┐
│  React SPA (Vite)          │  ──────────────────────▶  │  Express API + Socket.IO      │
│  • React Router            │      fetch + cookies      │  • JWT access tokens          │
│  • Auth/Theme/Toast ctx    │ ◀──────────────────────   │  • rotating refresh tokens    │
│  • Socket.IO client        │        socket events      │  • Zod validation, rate limits│
└────────────────────────────┘                           │  • store abstraction          │
                                                          └───────────────┬──────────────┘
                                                                          │ Mongoose
                                                                          ▼
                                                                ┌──────────────────┐
                                                                │ MongoDB Atlas    │
                                                                │ users, convos,   │
                                                                │ messages, tokens │
                                                                └──────────────────┘
```

**Data access layer.** All persistence goes through a small store interface
(`server/src/store/*`) with two interchangeable implementations:

| Driver | When to use | Persistence |
| --- | --- | --- |
| `mongo` (`DB_DRIVER=mongo`, `MONGODB_URI=...`) | **Production / Atlas** — Mongoose models with the indexes defined in `server/src/models` | Durable |
| `memory` (default when `MONGODB_URI` is empty) | Local demo and the automated test suite on machines without a reachable MongoDB server | Process memory only |

Both are exercised by the same test suite. `memory` logs a loud warning on boot and is refused in
production only if you explicitly set it — use `mongo` for anything real.

---

## 3. Project structure

```
client/
  index.html
  vite.config.js                # dev proxy for /api, /socket.io, /uploads
  vercel.json                   # SPA rewrites for Vercel
  scripts/
    e2e-check.mjs               # live two-session end-to-end check
    ssr-check.jsx               # render sanity check for every screen
  src/
    components/                 # Avatar, ChatHeader, MessageList, Composer, modals, …
    context/                    # AuthContext, ThemeContext, ToastContext
    hooks/                      # useChatWorkspace, useDebounce, useClickOutside
    lib/                        # formatting helpers, constants
    pages/                      # Login, Register, ForgotPassword, ResetPassword, Chat, NotFound
    services/                   # api.js (fetch + refresh), socket.js
    styles/                     # design tokens, base, auth, chat, components
    App.jsx  main.jsx

server/
  src/
    app.js                      # Express app (helmet, cors, cookies, routes)
    index.js                    # HTTP + Socket.IO bootstrap, graceful shutdown
    config/env.js               # env parsing + production fail-fast
    models/                     # User, Conversation, Message, tokens/blocks/reports
    store/                      # mongo/MongoStore.js, memory/MemoryStore.js, index.js
    services/                   # authService, chatService (shared REST + socket rules)
    controllers/                # auth, users, conversations
    routes/                     # /api/auth, /api/users, /api/conversations
    middleware/                 # auth, rateLimit, error, upload
    sockets/index.js            # authenticated Socket.IO handlers
    utils/                      # ApiError, tokens, validation, serialize, logger, mailer, demo data
    scripts/seed.js             # demo accounts
  tests/                        # node:test + supertest + socket.io-client
  .env.example
  uploads/                      # local avatar storage (git-ignored)

README.md  .env.example  DEPLOYMENT.md  render.yaml  .gitignore  package.json
```

---

## 4. Local setup

### Prerequisites
- Node.js **20 or newer** (developed on Node 22) and npm 10+
- A MongoDB database. **Either** a free MongoDB Atlas cluster (recommended, see below) **or** a local
  `mongod`. No MongoDB at hand? The app still runs in demo mode with the in-memory store.

### Steps

```bash
git clone <your-repo-url> chattingWebsite
cd chattingWebsite

# 1. Install dependencies
npm run install:all          # or: npm --prefix server install && npm --prefix client install

# 2. Configure the server
cp server/.env.example server/.env
#   → set MONGODB_URI and DB_DRIVER=mongo for a real database
#   → or leave MONGODB_URI empty to use the in-memory demo store

# 3. (Optional) seed demo accounts + conversations
npm run seed                 # accounts: aarav.sharma, priya.nair, rohan_verma, ananya.iyer
                             # password: Connectly123

# 4. Optional: use the same demo data automatically on every boot (demo mode only)
#    SEED_DEMO=true in server/.env

# 5. Run both processes (two terminals)
npm run dev:server           # http://localhost:4000  (health: /api/health)
npm run dev:client           # http://localhost:5173
```

Open <http://localhost:5173>, create two accounts (e.g. in a normal window and a private window),
search for the other username and start chatting.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev:server` | API + Socket.IO with `node --watch` |
| `npm run dev:client` | Vite dev server (proxies `/api`, `/socket.io`, `/uploads` to :4000) |
| `npm run seed` | Create demo accounts and conversations |
| `npm test` | Backend test suite (auth, authorization, messaging, rate limiting, pagination) against the in-memory store |
| `npm run test:mongo` | The same suite against MongoDB — requires `MONGODB_URI` |
| `npm run build` | Production build of the frontend |
| `npm --prefix client run check:render` | Server-render every screen to catch runtime render errors |
| `npm --prefix client run check:e2e` | Live two-session end-to-end check against a running stack |

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `MONGODB_URI is not set` | Add the Atlas URI to `server/.env`, or set `DB_DRIVER=memory` for the demo store. |
| Atlas `Could not connect to any servers` | Add your current IP under **Atlas → Network Access**, and check the password is URL-encoded. |
| Frontend shows "Cannot reach the server" | Start the API (`npm run dev:server`) and check `VITE_API_ORIGIN` in `client/.env`. |
| Socket connects then immediately errors | The access token expired — reload; the client refreshes automatically. |
| Cookies not saved in production | Frontend and API must both be HTTPS, with `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none`. |
| Login rate limited while testing | The limiter allows 10 attempts per 15 minutes per IP (disabled when `NODE_ENV=test`). |

---

## 5. MongoDB Atlas setup

1. Create a free account at <https://www.mongodb.com/cloud/atlas/register> and create an **M0 free
   cluster** (any region close to your users, e.g. Mumbai `ap-south-1`).
2. **Database Access → Add New Database User**: username + strong password, role
   *Read and write to any database*.
3. **Network Access → Add IP Address**: add your current IP for local development, and
   `0.0.0.0/0` for a cloud host such as Render (Render's outbound IPs change; restrict them for a
   stricter setup).
4. **Database → Connect → Drivers** and copy the connection string:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
5. Put it in `server/.env`:

   ```env
   DB_DRIVER=mongo
   MONGODB_URI=mongodb+srv://connectly_user:MyStrongPass@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=connectly
   ```

6. Start the API. On first boot Mongoose creates the collections and the indexes declared in
   `server/src/models/*` (unique usernames/emails, unique conversation pair keys, unique per-sender
   client message IDs, message pagination index, TTL indexes for expiring tokens).

> The database name is taken from `MONGODB_DB_NAME` (recommended) or from the path segment of the URI.

---

## 6. Environment variables

Everything is optional in development (sensible defaults are used), but **production refuses to boot**
without the required secrets. Copy `.env.example` → `.env` in `server/` and `client/`.

### Server

| Variable | Default | Required in production | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | yes (`production`) | Enables strict production behaviour. |
| `PORT` | `4000` | no | Render injects this automatically. |
| `DB_DRIVER` | `memory` if no URI else `mongo` | yes | Set `mongo` in production. |
| `MONGODB_URI` | – | yes | Atlas connection string. |
| `MONGODB_DB_NAME` | from URI | recommended | e.g. `connectly`. |
| `JWT_ACCESS_SECRET` | dev fallback | **yes** | Long random string (`openssl rand -hex 48`). |
| `JWT_REFRESH_SECRET` | dev fallback | **yes** | Different random string. |
| `ACCESS_TOKEN_TTL` | `15m` | no | Access token lifetime. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | no | Refresh cookie lifetime. |
| `BCRYPT_ROUNDS` | `12` | no | Password hashing cost. |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | **yes** | Comma-separated list of allowed frontend origins. |
| `APP_URL` | `http://localhost:5173` | yes | Frontend base URL, used in password-reset links. |
| `COOKIE_SECURE` | `true` in production | yes | Must be `true` on HTTPS. |
| `COOKIE_SAMESITE` | `none` in production, `lax` in dev | yes | `none` is required for a Vercel→Render cross-site setup. |
| `COOKIE_DOMAIN` | – | no | Only set if you need a shared parent domain. |
| `TRUST_PROXY` | `1` in production | no | Needed behind Render's proxy so secure cookies work. |
| `MESSAGE_MAX_LENGTH` | `4000` | no | Server-enforced message limit. |
| `AVATAR_MAX_BYTES` | `2097152` (2 MB) | no | Upload limit. |
| `SEARCH_PAGE_SIZE` | `10` | no | Max search results per page. |
| `MESSAGE_PAGE_SIZE` | `30` | no | Default history page size. |
| `UPLOAD_DIR` | `server/uploads` | no | Development fallback only. Render wipes this on deploy. |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | – | for durable avatars on Render | Optional S3-compatible storage. If unset, avatars go to GridFS when Mongo is connected. |
| `S3_REGION` / `S3_ENDPOINT` / `S3_PUBLIC_BASE_URL` | `auto` / – / – | with S3 | R2/MinIO: set `S3_ENDPOINT` and a public URL. |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_EMAIL` | – | to create the first admin | Promotes an **existing** account on boot, but only while no active administrator exists. Never put a password here. Clear it after the first boot. |
| `ALLOW_MEMORY_STORE` | `false` | no | Production refuses the in-memory store unless this is true. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | – | for password reset emails | Without these the reset link is only exposed in dev. |
| `SEED_DEMO` | `false` | no | Creates demo accounts on boot (never in production). |
| `BRAND_NAME` / `BRAND_TAGLINE` | Connectly | no | Server-side branding. |
| `LOG_LEVEL` | `info` in production | no | `debug`, `info`, `warn`, `error`. |

### Client (build-time, Vite)

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_ORIGIN` | `http://localhost:4000` | Dev proxy target only. |
| `VITE_API_URL` | *(empty → same origin)* | Production API origin, e.g. `https://connectly-api.onrender.com`. |
| `VITE_SOCKET_URL` | falls back to `VITE_API_URL` | Only needed if sockets live on another host. |

> `VITE_*` values are embedded in the built bundle — never put secrets there.

### Email (SMTP) for password resets

Password reset works end-to-end **only when SMTP is configured**:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-smtp-password
MAIL_FROM="Connectly <no-reply@yourdomain.com>"
```

Until then the API: generates the token, returns `emailDelivery: "not_configured"`, and (in
non-production only) returns a `devResetUrl` so you can still test the flow. In production it never
returns the link — configure SMTP (or swap `server/src/utils/mailer.js` for Resend/SES/SendGrid).

---

## 7. API reference

All endpoints are under `/api`. Authenticated routes accept `Authorization: Bearer <accessToken>`
or the SPA cookie. Errors always return `{ "error": { "message": "...", "code": "...", "details": {...} } }`.

### Auth
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | – | `{username,email,password,confirmPassword}` → user + access token, sets refresh cookie |
| POST | `/auth/login` | – | `{identifier,password}` (email or username) |
| POST | `/auth/refresh` | cookie | Rotates the refresh token, returns a new access token |
| POST | `/auth/logout` | cookie | Revokes the refresh token and clears cookies |
| GET | `/auth/me` | ✔ | Current profile |
| PATCH | `/auth/me` | ✔ | `{displayName?, bio?, avatarColor?, avatarUrl?, privacy?}` |
| POST | `/auth/me/avatar` | ✔ | multipart `avatar` (≤2 MB, jpeg/png/webp/gif) |
| POST | `/auth/me/avatar-color` | ✔ | `{avatarColor}` |
| POST | `/auth/me/password` | ✔ | `{currentPassword,newPassword,confirmPassword}` → revokes all sessions |
| POST | `/auth/me/logout-all` | ✔ | Revokes every session for the account |
| POST | `/auth/forgot-password` | – | `{email}` (always the same response) |
| POST | `/auth/reset-password` | – | `{token,password,confirmPassword}` |

### Users
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/users/search?q=&page=&limit=` | ✔ | Prefix username / exact ID search, excludes yourself |
| GET | `/users/:userId` | ✔ | Public profile + block state |
| POST | `/users/:userId/conversation` | ✔ | Get or create the direct conversation |
| POST | `/users/:userId/block` | ✔ | Block |
| DELETE | `/users/:userId/block` | ✔ | Unblock |
| POST | `/users/:userId/report` | ✔ | `{reason,details?,messageId?,conversationId?}` |

### Conversations & messages
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/conversations` | ✔ | Your conversations, newest first |
| GET | `/conversations/blocks` | ✔ | Users you blocked |
| GET | `/conversations/:id` | ✔ | Conversation + peer profile |
| GET | `/conversations/:id/messages?limit=&before=&beforeId=` | ✔ | Paginated history; use `nextCursor` + `nextCursorId` from the response as the next `before`/`beforeId` |
| POST | `/conversations/:id/messages` | ✔ | `{text,clientId?,replyToId?}` REST fallback for sending |
| PATCH | `/conversations/:id/messages/:messageId` | ✔ | `{text}` edit own message |
| DELETE | `/conversations/:id/messages/:messageId` | ✔ | `{scope: "me"\|"everyone"}` |
| POST | `/conversations/:id/messages/:messageId/reactions` | ✔ | `{emoji}` toggle |
| POST | `/conversations/:id/messages/:messageId/forward` | ✔ | `{targetConversationId}` |
| POST | `/conversations/:id/read` | ✔ | Mark as read, notifies the sender |
| POST | `/conversations/:id/delivered` | ✔ | Mark as delivered |
| GET | `/conversations/:id/unread` | ✔ | Unread count for you |
| DELETE | `/conversations/:id` | ✔ | Hide from your list only |
| GET | `/health` | – | Liveness + active store driver |
| GET | `/config` | – | Brand, limits, whether email is configured |

### Admin (role `admin` only)

Every route below is mounted behind `requireAuth` + `requireAdmin`: an anonymous request gets `401`
and a signed-in non-admin gets `403`, regardless of what the SPA displays. The role is always read
from the database record, never from the request body, a header or local storage.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/admin/overview` | admin | Real counts (users, conversations, messages, reports) + recent registrations and audit |
| GET | `/admin/me` | admin | The signed-in administrator's own account details |
| GET | `/admin/users?q=&status=&page=&limit=` | admin | Server-side search (username, display name, exact email), status filter and pagination |
| POST | `/admin/users` | admin | Create a user |
| PATCH | `/admin/users/:id/status` | admin | `active` / `suspended` / `deleted` (revokes sessions; protects the last admin and yourself) |
| PATCH | `/admin/users/:id/role` | admin | `user` / `admin` (not self, not last admin) |
| GET | `/admin/reports?status=&page=&limit=` | admin | Report queue: reporter, reported user, reason, the reporter's own details — never message text |
| PATCH | `/admin/reports/:id` | admin | Set report status to `open` / `reviewed` / `closed` (audited) |
| GET | `/admin/audit?page=&limit=` | admin | Audit log of every administrative action |

#### Creating the first administrator (development)

1. Register the account normally through `/register` (e.g. username `owner`). Signing up can never
   grant admin: `role` and `status` are server defaults.
2. In `server/.env` set exactly one of:
   ```bash
   BOOTSTRAP_ADMIN_USERNAME=owner
   # or
   BOOTSTRAP_ADMIN_EMAIL=owner@example.com
   ```
3. Restart the API (`npm run dev:server`). The boot log prints `Bootstrapped administrator from
   environment`. Promotion only happens while the deployment has **no active administrator**, so the
   variable is safe to leave in place but is best removed after the first boot.
4. Sign in as that account and open `/admin`.

#### Creating the first administrator (production)

Register the account on the live site, add `BOOTSTRAP_ADMIN_USERNAME` (or
`BOOTSTRAP_ADMIN_EMAIL`) to the API service environment (Render → Environment), redeploy/restart
once, confirm the log line, then remove the variable. No database migration is required: `role`,
`status` and `tokenVersion` already have defaults, and the audit trail lives in the new `auditlogs`
collection (created automatically by Mongoose on first write).

---

## 8. Real-time events

The socket handshake is authenticated with the access token (`auth.token` or the cookie). The server
joins each socket to its own `user:<id>` room and to the rooms of conversations it verifies the user
belongs to — **client-supplied conversation IDs are always re-validated**.

| Direction | Event | Payload | Notes |
| --- | --- | --- | --- |
| client → server | `message:send` | `{conversationId, text, clientId, replyToId?}` + ack | Persists first, then broadcasts; ack `{ok, message, duplicate}` |
| client → server | `message:edit` | `{conversationId, messageId, text}` | Own messages only |
| client → server | `message:delete` | `{conversationId, messageId, scope}` | `me` or `everyone` |
| client → server | `message:react` | `{conversationId, messageId, emoji}` | Toggle |
| client → server | `message:forward` | `{conversationId, messageId, targetConversationId}` | Creates a new message |
| client → server | `conversation:join` / `conversation:leave` | `{conversationId}` | Membership checked server-side |
| client → server | `typing:start` / `typing:stop` | `{conversationId}` | Sent only to the other participant |
| client → server | `message:read` | `{conversationId}` | Clears unread, notifies the sender |
| client → server | `message:delivered` | `{conversationId}` | Delivery receipt (sender derived server-side) |
| client → server | `presence:ping` | – | Optional latency check |
| server → client | `message:new` | `{message, conversationId, senderId, recipientId}` | Only to the two participants |
| server → client | `message:updated` | `{conversationId, message}` | Edits, delete-for-everyone, reactions |
| server → client | `message:removed` | `{conversationId, messageId}` | Delete-for-me, that user only |
| server → client | `message:read` | `{conversationId, readerId, readAt}` | Reader → sender only |
| server → client | `receipt:delivered` | `{conversationId, recipientId, deliveredAt}` | Recipient → sender only |
| server → client | `typing:start` / `typing:stop` | `{conversationId, userId}` | Peer only |
| server → client | `presence:update` | `{userId, online, lastSeen}` | Only to people with a conversation with that user |
| server → client | `conversation:unread` | `{conversationId, unreadCount}` | Your other tabs stay in sync |
| server → client | `block:changed` | `{userId, blocked, byMe}` | Both sides |

Socket payloads are capped (1 MB per frame), message sends are limited to ~20 per 10 s per socket on
top of the REST limiter, and every handler validates its input with Zod.

---

## 9. Testing

```bash
cd server
npm test            # auth, messaging, receipts, reactions, admin, moderation, avatars (in-memory store)
npm run test:mongo  # same suite against MongoDB (needs MONGODB_URI)
```

What is covered (`server/tests`):

- **Models**: Mongoose schema validation and the exact index definitions Atlas will create
  (unique username/email/pair-key/idempotency keys, TTL indexes for tokens) — run without a database.
- **Registration**: happy path, weak password, mismatched confirmation, invalid/reserved usernames,
  duplicate username and email (case-insensitive), no hash/token leakage in responses.
- **Sessions**: login by username and email, wrong password vs. unknown account returning the same
  message, protected routes rejecting anonymous calls, cookie session surviving a reload, logout,
  refresh rotation, and rejection + family revocation on refresh-token replay.
- **Profiles**: profile updates and privacy, emails hidden from other users, password change
  invalidating other sessions.
- **Search**: partial username, exact ID, self-exclusion, query validation and result caps.
- **Conversations**: one conversation per pair (including concurrent/duplicate creation and reversed
  order), self-conversation rejection, preview/ordering/unread updates, hide-for-me-only behaviour.
- **Authorization**: third users cannot read, post to or open someone else's conversation; sockets
  without a token are refused.
- **Real-time**: instant delivery both ways, receipts, persistence across a reload, idempotent retries,
  content/length validation, non-members cannot join rooms nor receive messages, presence only reaches
  peers.
- **Blocking** and **security**: hardened headers, CORS rejection, oversized payload, JSON 404 without
  stack traces, rate-limiter behaviour, control-character sanitisation, regex-safe search, history
  pagination without overlaps.

Additional live checks (require the app running):

```bash
cd client
npm run check:render   # server-renders every screen
npm run check:e2e      # two real sessions: register → search → chat → receipts → access denied
```

---

## 10. Security model

Implemented:

- **Password hashing** with bcrypt; `passwordHash` is `select: false` and never serialised.
- **Rotating refresh tokens** stored as SHA-256 hashes, httpOnly/Secure/SameSite cookies, replay
  detection with family revocation. Access tokens are short-lived and kept in memory by the SPA.
- **Authorization on every message, read and conversation access** — REST and Socket.IO share the same
  service layer (`services/chatService.js`), and socket rooms are derived from the database, never
  from client input.
- **Persist before acknowledging**; server-generated IDs and timestamps; per-sender idempotency keys.
- **Validation & sanitisation** with Zod on the server for every body/query/params, plus control
  character stripping. React escapes all rendered text (no `dangerouslySetInnerHTML`).
- **Rate limiting** on login (10/15 min), registration (10/h), password reset (5/h), search (40/min),
  REST message send (60/min) and socket sends (20/10 s).
- **Hardened headers** via Helmet, restrictive CORS with credentials for approved origins only,
  body size cap (64 kB), upload type/size checks with random filenames.
- **Generic errors in production** (no stack traces), structured logs that never include passwords,
  tokens, cookies or message bodies.
- **Production fail-fast** if `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or `MONGODB_URI` are missing.

Not implemented (be aware):

- **No end-to-end encryption.** Messages are stored readable in MongoDB. TLS protects them in transit,
  and only conversation participants can fetch them through the API — but the server can read them.
- Rate limiting and presence live in process memory: a multi-instance deployment needs Redis (see
  `Scaling notes` in `DEPLOYMENT.md`).
- No email verification, 2FA, CAPTCHA or automated moderation; reports are stored for human review.

---

## 11. Deployment

Short version — full walkthrough in **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

**Backend on Render (or Fly/Railway/Heroku):**
- Root directory `server`, build `npm install`, start `npm start`.
- Env: `NODE_ENV=production`, `DB_DRIVER=mongo`, `MONGODB_URI`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://<your-app>.vercel.app`, `APP_URL=https://<your-app>.vercel.app`,
  `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `TRUST_PROXY=1`.
- A ready-to-use blueprint is included: `render.yaml`.

**Frontend on Vercel:**
- Root directory `client`, framework Vite, build `npm run build`, output `dist`.
- Env: `VITE_API_URL=https://<your-api>.onrender.com`, `VITE_SOCKET_URL=https://<your-api>.onrender.com`.
- `client/vercel.json` already rewrites all routes to `index.html` for React Router.

---

## 12. Known limitations & honest verification notes

This repository was built and verified as follows — please read this before deploying.

**Verified in this environment**
- `server`: 51 automated tests pass (`npm test`) covering auth, authorization, real-time messaging,
  receipts, blocking, rate limiting, security headers, schema/index definitions and pagination.
- Live end-to-end check (`client/scripts/e2e-check.mjs`) against the running API **through the Vite dev
  proxy**: two accounts registered, search, conversation creation, bidirectional real-time messages,
  read receipt, persisted history, third-user access denied, refresh rotation + replay rejection.
  19/19 checks passed.
- `client`: production build succeeds; every screen server-renders without runtime errors
  (`npm run check:render`).
- The frontend was **not** exercised in a real browser in this sandbox (no browser available), so
  visual polish, mobile breakpoints and notification prompts were reviewed by code, not by clicking.

**Not verified here / needs your environment**
- **MongoDB path was not executed**: no MongoDB server was installed or downloadable in the build
  sandbox (`fastdl.mongodb.org` and the OS package mirror are unreachable), so the Mongoose-backed
  `MongoStore` and Atlas indexes were written and reviewed but only the in-memory driver was executed.
  Run `npm run test:mongo` against an Atlas cluster (or local `mongod`) to confirm before go-live.
- **No deployment was performed** — Render/Vercel steps in `DEPLOYMENT.md` are manual.
- **Email delivery** needs SMTP credentials; without them reset links are dev-only.
- **Avatar uploads** are written to the API's local disk (`server/uploads`). Render's filesystem is
  ephemeral, so mount a disk (`UPLOAD_DIR`) or replace `middleware/upload.js` with S3/Cloudinary.
- Rate limiting is per-instance; horizontal scaling needs a shared store.
- Browsers may block third-party cookies in a cross-site Vercel→Render setup (Safari/ITP). If that
  affects your users, serve the frontend and API from the same site (custom domain + reverse proxy) —
  the app supports same-origin mode out of the box.

**Demo mode.** If `MONGODB_URI` is empty the API boots with the in-memory store and logs a warning;
data disappears on restart. Use `SEED_DEMO=true` to get demo accounts on every boot
(password `Connectly123`). Never ship demo mode: set `DB_DRIVER=mongo` and a real `MONGODB_URI`.
