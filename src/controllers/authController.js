// ============================================================
// VifeMS — Auth Controller
// src/controllers/authController.js
//
// Controllers handle HTTP concerns only: parsing the request,
// calling the appropriate service function, and formatting
// the response. Business logic lives in authService.js.
// ============================================================

import {
  registerUser,
  verifyCredentials,
  createToken,
  generatePasswordResetToken,
  resetPassword as updatePassword,
} from "../services/authService.js";
import { sendPasswordResetEmail, sendWelcomeEmail } from "../services/emailService.js";
import passport from "../config/passport.js";

// Cookie name used for the HTTP-only auth token.
const AUTH_COOKIE = "authToken";

/**
 * Returns cookie options appropriate for the current environment.
 * Secure and SameSite=None are required for cross-origin requests
 * in production (e.g., when the frontend is on a different domain).
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,           // Not accessible via JS — protects against XSS.
    secure: isProduction,     // HTTPS only in production.
    sameSite: "lax",          // Lax is safer and works if frontend/backend share a domain.
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds.
    path: "/",
  };
}

// ------------------------------------------------------------
// POST /api/auth/register
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user account
 *     description: >
 *       Creates a new user account. The password is hashed with bcrypt
 *       before storage. The password hash is never returned in the response.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             fullName: "Victor Dosunmu"
 *             email: "victor@example.com"
 *             password: "securePassword123"
 *     responses:
 *       201:
 *         description: Account created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               message: "Account created successfully"
 *               data:
 *                 user:
 *                   id: "clxyz123abc"
 *                   fullName: "Victor Dosunmu"
 *                   email: "victor@example.com"
 *       400:
 *         description: Validation error — missing or invalid fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Password must be at least 8 characters."
 *       409:
 *         description: Email already registered.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "An account with this email already exists."
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export async function register(req, res, next) {
  try {
    const { fullName, email, password } = req.body;

    // --- Validation ---
    const missing = [];
    if (!fullName) missing.push("fullName");
    if (!email) missing.push("email");
    if (!password) missing.push("password");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}.`,
      });
    }

    if (typeof fullName !== "string" || fullName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name must be at least 2 characters.",
      });
    }

    // Basic email format check.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    // --- Service call ---
    const user = await registerUser({ fullName, email, password });

    // --- Welcome email (non-blocking) ---
    // Fired after successful user creation. Email failure must never break registration.
    try {
      await sendWelcomeEmail({ to: user.email, fullName: user.fullName });
    } catch (emailErr) {
      console.error("[Auth] Failed to send welcome email:", emailErr.message);
    }

    // Issue auth token and set cookie
    const token = createToken({ id: user.id, email: user.email });
    res.cookie(AUTH_COOKIE, token, getCookieOptions());

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      data: { user, token },
      token,
    });
  } catch (err) {
    if (err.code === "EMAIL_TAKEN") {
      return res.status(409).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

// ------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Log in to an existing account
 *     description: >
 *       Validates credentials and issues a signed JWT stored in an
 *       HTTP-only cookie. The cookie is used for all subsequent
 *       authenticated requests. A generic error is returned on failure
 *       to avoid exposing whether a given email is registered.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "victor@example.com"
 *             password: "securePassword123"
 *     responses:
 *       200:
 *         description: Login successful. Auth cookie is set.
 *         headers:
 *           Set-Cookie:
 *             description: HTTP-only authToken cookie.
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               message: "Login successful."
 *               data:
 *                 user:
 *                   id: "clxyz123abc"
 *                   fullName: "Victor Dosunmu"
 *                   email: "victor@example.com"
 *       400:
 *         description: Missing required fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Invalid email or password."
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await verifyCredentials(email, password);
    const token = createToken({ id: user.id, email: user.email });

    res.cookie(AUTH_COOKIE, token, getCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: { user },
    });
  } catch (err) {
    if (err.code === "INVALID_CREDENTIALS") {
      return res.status(401).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

// ------------------------------------------------------------
// POST /api/auth/logout
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Log out the current user
 *     description: >
 *       Clears the HTTP-only authentication cookie, effectively ending
 *       the session. Safe to call even when not authenticated.
 *     responses:
 *       200:
 *         description: Logged out successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               message: "Logged out successfully."
 */
export function logout(req, res) {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  return res.status(200).json({
    success: true,
    message: "Logged out successfully.",
  });
}

// ------------------------------------------------------------
// GET /api/auth/me
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get the currently authenticated user
 *     description: >
 *       Returns the profile of the authenticated user based on the
 *       auth cookie. Requires a valid session — returns 401 if not
 *       authenticated. The user object is populated by `requireAuth`
 *       middleware before this controller runs.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Currently authenticated user.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               data:
 *                 user:
 *                   id: "clxyz123abc"
 *                   fullName: "Victor Dosunmu"
 *                   email: "victor@example.com"
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Authentication required."
 */
export function me(req, res) {
  // req.user is populated by requireAuth middleware.
  return res.status(200).json({
    success: true,
    data: { user: req.user },
  });
}

// ------------------------------------------------------------
// POST /api/auth/forgot-password
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request a password reset email
 *     description: >
 *       Generates a password reset token and sends a reset link to the user's email.
 *       Always returns a successful generic response to prevent account enumeration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "victor@example.com"
 *     responses:
 *       200:
 *         description: Generic success message (whether email exists or not).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               message: "If an account exists for this email, a password reset link has been sent."
 *       400:
 *         description: Missing or invalid email.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Please provide a valid email address."
 */
// (imports moved to top of file)

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const rawToken = await generatePasswordResetToken(email);

    if (rawToken) {
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
      const resetUrl = `${clientUrl}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    // Always return the same response
    return res.status(200).json({
      success: true,
      message: "If an account exists for this email, a password reset link has been sent.",
    });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------
// POST /api/auth/reset-password
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset password using a valid token
 *     description: >
 *       Updates the user's password using the raw token provided in the password reset email.
 *       Upon success, previously issued sessions/tokens will be invalidated.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *                 example: "example-reset-token"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "NewSecurePassword123!"
 *     responses:
 *       200:
 *         description: Password reset successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               message: "Password reset successfully."
 *       400:
 *         description: Missing fields or invalid password format.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Password must be at least 8 characters."
 *       401:
 *         description: Invalid or expired password reset token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Invalid or expired password reset token."
 */
export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Token and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    await updatePassword(token, password);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully.",
    });
  } catch (err) {
    if (err.message === "Invalid or expired password reset token.") {
      return res.status(401).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

/**
 * Returns true when Google OAuth is configured and the strategy registered.
 */
function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * @openapi
 * /api/auth/google:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Initiate Google OAuth login
 *     description: >
 *       Browser-redirect endpoint. Redirects the user to Google's OAuth
 *       consent screen. The browser must navigate to this URL directly —
 *       it cannot be called as a JSON API. After Google authentication,
 *       the user is redirected to /api/auth/google/callback.
 *
 *       Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to be configured.
 *       Returns 503 if Google OAuth is not configured on the server.
 *     responses:
 *       302:
 *         description: Redirects to Google's OAuth consent screen.
 *       503:
 *         description: Google OAuth is not configured on this server.
 */
export function google(req, res, next) {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      success: false,
      message: "Google OAuth is not configured on this server.",
    });
  }
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
}

// ------------------------------------------------------------
// GET /api/auth/google/callback
// ------------------------------------------------------------

/**
 * @openapi
 * /api/auth/google/callback:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Google OAuth callback
 *     description: >
 *       Browser-redirect endpoint. Google calls this URL after the user
 *       authenticates. This endpoint is not intended to be called directly
 *       by the frontend as a JSON API.
 *
 *       On success: finds or creates the VifeMS user, issues the VifeMS JWT,
 *       sets the authToken HTTP-only cookie, and redirects to
 *       CLIENT_URL/dashboard. The frontend should then call GET /api/auth/me.
 *
 *       On failure: redirects to CLIENT_URL/login with a generic error query
 *       parameter. Error details are never exposed in the redirect URL.
 *
 *       Account linking policy: if a VifeMS email/password account exists
 *       for the Google email, the user is redirected to
 *       /login?error=email_exists_no_google — no automatic linking occurs.
 *     responses:
 *       302:
 *         description: >
 *           Redirects to CLIENT_URL/dashboard on success,
 *           or CLIENT_URL/login?error=... on failure.
 */
export function googleCallback(req, res, next) {
  if (!isGoogleConfigured()) {
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    return res.redirect(`${clientUrl}/login?error=google_auth_failed`);
  }

  passport.authenticate("google", { session: false }, async (err, user, info) => {
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

    if (err) {
      if (err.code === "EMAIL_EXISTS_NO_GOOGLE") {
        return res.redirect(`${clientUrl}/login?error=email_exists_no_google`);
      }
      // Log full error so you can diagnose in the backend console
      console.error("[Auth] Google OAuth error:", err.message, err.code, err.stack);
      return res.redirect(`${clientUrl}/login?error=google_auth_failed`);
    }

    if (!user) {
      console.error("[Auth] Google OAuth: no user returned. info:", info);
      return res.redirect(`${clientUrl}/login?error=google_auth_failed`);
    }

    try {
      // Reuse existing JWT — same token used for email/password login.
      const token = createToken({ id: user.id, email: user.email });

      // Set the existing authToken cookie — same name, same options.
      res.cookie(AUTH_COOKIE, token, getCookieOptions());

      // Send welcome email only for brand-new Google users.
      if (user.isNewUser) {
        try {
          await sendWelcomeEmail({ to: user.email, fullName: user.fullName });
        } catch (emailErr) {
          console.error("[Auth] Failed to send welcome email (Google):", emailErr.message);
        }
      }

      // Redirect to frontend. Frontend calls GET /api/auth/me to get user profile.
      return res.redirect(`${clientUrl}/dashboard`);
    } catch (tokenErr) {
      return res.redirect(`${clientUrl}/login?error=google_auth_failed`);
    }
  })(req, res, next);
}
