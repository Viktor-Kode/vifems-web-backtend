// ============================================================
// VifeMS — Auth Middleware
// src/middleware/authMiddleware.js
//
// Protects routes that require an authenticated user.
// Reads the JWT from the HTTP-only cookie, verifies it,
// fetches the user from the database, and attaches the
// user object to `req.user`.
//
// Usage in a route file:
//   import { requireAuth } from "../middleware/authMiddleware.js";
//   router.get("/me", requireAuth, meController);
// ============================================================

import { verifyToken, getUserById } from "../services/authService.js";

/**
 * Express middleware that enforces authentication.
 *
 * On success: populates `req.user` and calls `next()`.
 * On failure: responds with 401 Unauthorized.
 */
export async function requireAuth(req, res, next) {
  try {
    let token = req.cookies?.authToken;
    if (!token && req.headers?.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // verifyToken throws if the token is invalid or expired.
    const decoded = verifyToken(token);

    const user = await getUserById(decoded.id);

    if (!user) {
      // Token was valid but the user no longer exists in the database.
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // Invalidate tokens issued before the password was last changed
    if (user.passwordChangedAt) {
      const changedTimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
      if (decoded.iat < changedTimestamp) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }
    }

    // Attach the authenticated user to the request so controllers
    // can access it without repeating auth checks.
    req.user = user;
    next();
  } catch {
    // Covers expired tokens, malformed tokens, and any unexpected errors.
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }
}
