// ============================================================
// VifeMS — Authentication Service
// src/services/authService.js
//
// All business logic for user authentication lives here.
// Controllers call service functions — they never touch
// Prisma directly. This keeps controllers thin and makes
// the authentication logic independently testable.
// ============================================================

import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/database.js";

// Number of bcrypt salt rounds. 12 is a solid default that
// balances security against hashing time (~300ms on modern HW).
const SALT_ROUNDS = 12;

/**
 * Registers a new user.
 *
 * @param {object} params
 * @param {string} params.fullName
 * @param {string} params.email  - Will be lowercased before storage.
 * @param {string} params.password
 * @returns {Promise<{id: string, fullName: string, email: string}>}
 * @throws {Error} If the email is already registered (code: EMAIL_TAKEN).
 */
export async function registerUser({ fullName, email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check for duplicate email before attempting to create.
  // This gives us a friendly error rather than a raw Prisma constraint violation.
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.code = "EMAIL_TAKEN";
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
    },
    // Explicitly select only the fields that are safe to return.
    // passwordHash must never leave the service layer.
    select: { id: true, fullName: true, email: true, createdAt: true },
  });

  return user;
}

/**
 * Validates credentials and returns the safe user object.
 *
 * Uses a generic error message regardless of whether the email
 * exists or the password is wrong, to avoid account enumeration.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{id: string, fullName: string, email: string}>}
 * @throws {Error} If credentials are invalid (code: INVALID_CREDENTIALS).
 */
export async function verifyCredentials(email, password) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Always run bcrypt comparison to prevent timing attacks that could
  // reveal whether an email address exists in the database.
  const dummyHash =
    "$2a$12$invalidhashpaddingtomakethisalwaysrunthebcryptcompare";
  const passwordHash = user ? user.passwordHash : dummyHash;

  const isValid = await bcrypt.compare(password, passwordHash);

  if (!user || !isValid) {
    const err = new Error("Invalid email or password.");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  return { id: user.id, fullName: user.fullName, email: user.email };
}

/**
 * Creates a signed JWT for the given user payload.
 *
 * @param {{ id: string, email: string }} payload
 * @returns {string} Signed JWT string.
 */
export function createToken(payload) {
  return jwt.sign(payload, process.env.AUTH_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

/**
 * Verifies a JWT and returns its decoded payload.
 *
 * @param {string} token
 * @returns {{ id: string, email: string, iat: number, exp: number }}
 * @throws {JsonWebTokenError | TokenExpiredError} If token is invalid.
 */
export function verifyToken(token) {
  return jwt.verify(token, process.env.AUTH_SECRET);
}

/**
 * Retrieves a user by ID, returning only safe fields.
 *
 * @param {string} id
 * @returns {Promise<{id: string, fullName: string, email: string} | null>}
 */
export async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, fullName: true, email: true, createdAt: true, passwordChangedAt: true },
  });
}

/**
 * Generates a password reset token for the given email.
 * If the user exists, stores the hashed token and returns the raw token.
 * If the user does not exist, returns null.
 * 
 * @param {string} email 
 * @returns {Promise<string | null>} raw token
 */
export async function generatePasswordResetToken(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  
  if (!user) {
    return null;
  }

  // Generate secure random token
  const rawToken = crypto.randomBytes(32).toString("hex");
  
  // Hash the token
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Calculate expiration
  const expiresInMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRES_MINUTES || "30", 10);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  // Invalidate previous unused reset tokens for this user
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null }
  });

  // Store hashed token
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    }
  });

  return rawToken;
}

/**
 * Validates a password reset token and updates the user's password.
 * 
 * @param {string} rawToken 
 * @param {string} newPassword 
 * @throws {Error} if token is invalid or expired
 */
export async function resetPassword(rawToken, newPassword) {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!resetToken) {
    throw new Error("Invalid or expired password reset token.");
  }

  if (resetToken.usedAt) {
    throw new Error("Invalid or expired password reset token.");
  }

  if (resetToken.expiresAt < new Date()) {
    throw new Error("Invalid or expired password reset token.");
  }

  if (!resetToken.user) {
    throw new Error("Invalid or expired password reset token.");
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  
  const now = new Date();

  // Update user password and passwordChangedAt to invalidate existing sessions
  await prisma.user.update({
    where: { id: resetToken.userId },
    data: {
      passwordHash,
      passwordChangedAt: now,
    }
  });

  // Mark token as used
  await prisma.passwordResetToken.update({
    where: { id: resetToken.id },
    data: { usedAt: now }
  });
}

/**
 * Handles finding, linking, or creating a user from a Google OAuth profile.
 * 
 * @param {object} profile Google profile
 * @returns {Promise<{id: string, fullName: string, email: string}>}
 * @throws {Error} if account linking is disallowed or fails
 */
export async function handleGoogleOAuthUser(profile) {
  const googleId = profile.id;
  const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase().trim() : null;
  const fullName = profile.displayName || "Google User";

  if (!email) {
    throw new Error("No email found in Google profile.");
  }

  // 1. Try to find user by googleId
  let user = await prisma.user.findUnique({ where: { googleId } });
  if (user) {
    return { id: user.id, fullName: user.fullName, email: user.email, isNewUser: false };
  }

  // 2. Try to find user by email
  user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    // A user exists with this email, but no googleId.
    // For security, do not automatically link without explicit policy.
    // We return an error so the frontend can handle it (e.g. prompt to login via email to link).
    const err = new Error("An account with this email already exists. Please log in with your email and password.");
    err.code = "EMAIL_EXISTS_NO_GOOGLE";
    throw err;
  }

  // 3. Create new user
  user = await prisma.user.create({
    data: {
      googleId,
      email,
      fullName,
      // No passwordHash since they registered via Google.
    },
    select: { id: true, fullName: true, email: true, createdAt: true },
  });

  return { id: user.id, fullName: user.fullName, email: user.email, isNewUser: true };
}

