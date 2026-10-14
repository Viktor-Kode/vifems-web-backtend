// ============================================================
// VifeMS — Auth Routes
// src/routes/authRoutes.js
//
// Maps HTTP methods and paths to controller functions.
// Authentication middleware is applied per-route to protect
// endpoints that require a valid session.
// ============================================================

import { Router } from "express";
import { register, login, logout, me, forgotPassword, resetPassword, google, googleCallback } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiter for forgot-password
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: "Too many password reset requests, please try again later."
  }
});

// Public routes — no authentication required.
router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

// Google OAuth routes
router.get("/google", google);
router.get("/google/callback", googleCallback);

// Protected routes — requireAuth runs before the controller.
router.get("/me", requireAuth, me);

export default router;
