# VifeMS Backend

> AI-native business management platform — backend API.

Node.js · Express.js · PostgreSQL · Prisma ORM · JWT · Nodemailer · Swagger/OpenAPI

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in your values
cp .env.example .env

# 3. Apply the database schema
npx prisma migrate dev --name init

# 4. Start the development server
npm run dev
```

Server runs at **http://localhost:5000**

---

## API Documentation

Interactive Swagger UI is available at:

```
http://localhost:5000/api-docs
```

The raw OpenAPI 3.x specification (JSON) is available at:

```
http://localhost:5000/api-docs/swagger.json
```

Swagger/OpenAPI is the **source of truth** for the VifeMS API contract. Every endpoint is documented with request schemas, response schemas, status codes, and examples.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: `5000`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | JWT signing secret (≥32 random characters) |
| `JWT_EXPIRES_IN` | No | Token lifetime (default: `7d`) |
| `CLIENT_URL` | ✅ | Frontend origin for CORS (e.g. `http://localhost:3000`) |
| `NODE_ENV` | No | `development` or `production` |
| `PASSWORD_RESET_EXPIRES_MINUTES` | No | Password reset token validity (default: `30`) |
| `SMTP_HOST` | ✅ | SMTP host — `smtp.gmail.com` for Gmail |
| `SMTP_PORT` | No | SMTP port — `465` for Gmail SSL (default: `465`) |
| `SMTP_SECURE` | No | `true` for port 465 SSL, `false` for STARTTLS (default: `true`) |
| `SMTP_USER` | ✅ | Gmail address used to send emails |
| `SMTP_PASS` | ✅ | Gmail **App Password** (not your normal Gmail password) |
| `EMAIL_FROM` | No | Sender display string, e.g. `"VifeMS <you@gmail.com>"` |
| `GOOGLE_CLIENT_ID` | No* | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No* | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | Google OAuth callback URL (default: `http://localhost:5000/api/auth/google/callback`) |

> \* Required if Google OAuth login is enabled.

> **Never commit `.env` to Git.** `.env.example` contains safe placeholders only.

Generate a strong `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health check |
| `POST` | `/api/auth/register` | Public | Create a new account |
| `POST` | `/api/auth/login` | Public | Log in, receive auth cookie |
| `POST` | `/api/auth/logout` | Public | Clear auth cookie |
| `GET` | `/api/auth/me` | 🔒 Required | Get current user profile |
| `POST` | `/api/auth/forgot-password` | Public | Request password reset email |
| `POST` | `/api/auth/reset-password` | Public | Reset password with token |
| `GET` | `/api/auth/google` | Public | Initiate Google OAuth login |
| `GET` | `/api/auth/google/callback` | Public | Google OAuth callback (browser redirect) |

---

## Authentication

VifeMS uses **JWT stored in an HTTP-only cookie** for session management.

### Flow

1. **Register** — `POST /api/auth/register` with `fullName`, `email`, `password`.
2. **Login** — `POST /api/auth/login` with `email`, `password`. The server sets an `authToken` HTTP-only cookie.
3. **Authenticated requests** — The browser automatically includes the cookie. Protected routes verify the JWT via `requireAuth` middleware.
4. **Logout** — `POST /api/auth/logout` clears the cookie.

### Cookie Behaviour

| Property | Value |
|---|---|
| Name | `authToken` |
| `httpOnly` | `true` — inaccessible to JavaScript (XSS protection) |
| `secure` | `true` in production — HTTPS only |
| `sameSite` | `none` in production, `lax` in development |
| `maxAge` | 7 days |

### Password Storage

Passwords are hashed with **bcrypt** (12 salt rounds) before storage. Plain-text passwords and password hashes are **never returned** in API responses.

### Credential Errors

Authentication failure responses use a **generic message** regardless of whether the email exists. This prevents account enumeration attacks.

---

## Password Recovery

VifeMS includes a secure forgot/reset password flow:

1. **Forgot Password** — `POST /api/auth/forgot-password` generates a secure random token (hashed in DB) and sends a reset email. It always returns a generic success response to prevent account enumeration. Rate limited to 5 requests per 15 minutes.
2. **Email Delivery** — Transactional emails are sent via **Nodemailer → Gmail SMTP** (port 465, SSL). Configure the required `SMTP_*` environment variables. Gmail requires an **App Password** — not your normal Gmail account password. Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

   **Authentication emails:**
   - **Welcome emails** — sent once when a new account is created (email/password or Google OAuth first-time login). Failure never breaks registration.
   - **Password reset emails** — sent on `POST /api/auth/forgot-password`.

   Both use the same Nodemailer transporter defined in `src/services/emailService.js`.
3. **Reset Password** — `POST /api/auth/reset-password` consumes the token and sets a new password. The token is verified for validity, expiration (30 mins by default), and unused status.
4. **Session Invalidation** — Upon a successful password reset, `passwordChangedAt` is updated on the user model, which instantly invalidates all previously issued JWTs.

### Email security model

```
Random token → SHA-256 hash → stored in PostgreSQL
Raw token embedded in reset URL → emailed to user
User clicks link → token hashed again → compared with stored hash
Password reset → token marked used → passwordChangedAt updated
```

The raw token is **never stored** in PostgreSQL.

### Required SMTP environment variables

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="VifeMS <your-email@gmail.com>"
```

---

## Architecture

```
Routes          (src/routes/)
  ↓
Controllers     (src/controllers/)   — HTTP parsing, response formatting
  ↓
Services        (src/services/)      — Business logic, Prisma queries
  ↓
Prisma ORM      (prisma/schema.prisma)
  ↓
PostgreSQL
```

**Middleware** (`src/middleware/`) handles cross-cutting concerns:

- `authMiddleware.js` — JWT verification, `req.user` population
- `errorMiddleware.js` — Centralized error handling and 404s

**Config** (`src/config/`) holds shared infrastructure:

- `database.js` — Singleton Prisma client

**Docs** (`src/docs/`) contains API documentation:

- `swagger.js` — OpenAPI 3.x spec generation via `swagger-jsdoc`

---

## Project Structure

```
vifems-backend/
├── prisma/
│   └── schema.prisma          # Database schema (User model)
│
├── src/
│   ├── config/
│   │   ├── database.js        # Prisma client singleton
│   │   └── passport.js        # Passport Google OAuth strategy
│   │
│   ├── controllers/
│   │   └── authController.js  # Auth HTTP handlers + OpenAPI annotations
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js  # JWT verification, req.user population
│   │   └── errorMiddleware.js # Centralized error + 404 handler
│   │
│   ├── routes/
│   │   └── authRoutes.js      # Route ↔ controller mapping
│   │
│   ├── services/
│   │   ├── authService.js     # Auth business logic, Prisma queries
│   │   └── emailService.js    # Nodemailer Gmail SMTP — welcome + password reset emails
│   │
│   ├── docs/
│   │   └── swagger.js         # OpenAPI spec configuration
│   │
│   ├── app.js                 # Express app setup (middleware + routes)
│   └── server.js              # Entry point — binds to PORT
│
├── .env                       # Local secrets (not committed)
├── .env.example               # Variable reference (safe to commit)
├── .gitignore
├── package.json
└── README.md
```

---

## Google Authentication

VifeMS supports **Google OAuth 2.0** via [Passport.js](https://www.passportjs.org/packages/passport-google-oauth20/).

Google login and email/password login ultimately produce the **same VifeMS identity** — a `User` record, a VifeMS JWT, and an `authToken` HTTP-only cookie.

### Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google+ API** or **Google Identity** and create OAuth 2.0 credentials.
3. Set the **Authorized redirect URI** exactly to:
   ```
   http://localhost:5000/api/auth/google/callback
   ```
   (Use your production URL in production.)
4. Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into `.env`.

### Flow

```
Frontend navigates to GET /api/auth/google
  ↓
Passport redirects to Google
  ↓
User authenticates with Google
  ↓
Google redirects to GET /api/auth/google/callback
  ↓
Passport verifies → VifeMS finds/creates User
  ↓
VifeMS issues JWT → sets authToken HTTP-only cookie
  ↓
Redirects to CLIENT_URL/dashboard
  ↓
Frontend calls GET /api/auth/me → receives user profile
```

### Account Linking Policy

| Scenario | Behaviour |
|---|---|
| **New Google user** | A new `User` is created with `googleId`, `email`, `fullName`. No `passwordHash` is stored. |
| **Existing Google user** | Looked up by `googleId` and logged in. No duplicate created. |
| **Email/password account + same Google email** | **Blocked.** The user is redirected to `/login?error=email_exists_no_google`. They must log in with their email/password. Automatic account linking is not implemented — security takes priority. |

### Required Environment Variables

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
CLIENT_URL=http://localhost:3000
```

> If `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` are not set, a warning is logged and Google login is disabled (existing email/password auth is unaffected).

---

## Database

Prisma is used as the ORM over PostgreSQL.

```bash
# Apply pending migrations
npx prisma migrate dev

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Regenerate the Prisma client after schema changes
npx prisma generate
```

### User Model

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (CUID) | Primary key |
| `fullName` | `String` | |
| `email` | `String` | Unique, lowercased on write |
| `passwordHash` | `String?` | bcrypt, nullable (Google-only users have no password) |
| `googleId` | `String?` | Unique Google account ID, null for email/password users |
| `createdAt` | `DateTime` | Auto-set on create |
| `updatedAt` | `DateTime` | Auto-updated |

---

## Development Scripts

```bash
npm run dev      # Start with nodemon (auto-restart on changes)
npm start        # Start without nodemon
```
