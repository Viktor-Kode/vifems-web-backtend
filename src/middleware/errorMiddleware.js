// ============================================================
// VifeMS — Error Handling Middleware
// src/middleware/errorMiddleware.js
//
// Centralized error handler. Must be registered LAST in
// app.js (after all routes) because Express identifies
// error handlers by their 4-argument signature.
//
// This keeps try/catch boilerplate out of controllers and
// ensures all unhandled errors return a consistent JSON
// response format without leaking stack traces in production.
// ============================================================

/**
 * Centralized Express error handler.
 *
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Log the full error internally — never send stack traces to clients.
  console.error("[VifeMS Error]", {
    message: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  // Prisma unique constraint violation (e.g., duplicate email at DB level).
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "A record with that value already exists.",
    });
  }

  const requestedStatus = Number(err.status || err.statusCode || 500);
  const status = requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  const message =
    status >= 500 && process.env.NODE_ENV !== "development"
      ? "An unexpected error occurred."
      : err.message || "An unexpected error occurred.";

  res.status(status).json({ success: false, message });
}

/**
 * 404 handler for unmatched routes.
 * Register this AFTER all routes but BEFORE errorHandler.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
}
