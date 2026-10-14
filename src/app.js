// ============================================================
// VifeMS — Express Application
// src/app.js
//
// Configures and exports the Express application.
// Separated from server.js so the app can be imported
// cleanly in tests without binding to a port.
// ============================================================

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import financialRoutes from "./routes/financialRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorMiddleware.js";
import swaggerSpec from "./docs/swagger.js";
import passport from "./config/passport.js";

// swagger-ui-express does not yet ship ES Module exports,
// so we use a dynamic import workaround for compatibility.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const swaggerUi = require("swagger-ui-express");

const app = express();

// ------------------------------------------------------------
// CORS
// Allows configured and local development frontend origins to
// send credentials (cookies) cross-origin.
// ------------------------------------------------------------
const configuredClientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const allowedOrigins = new Set(
  [
    configuredClientUrl,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
  ].filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      if (
        process.env.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

// ------------------------------------------------------------
// Body & Cookie Parsing
// ------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// ------------------------------------------------------------
// API Documentation — Swagger UI
// ------------------------------------------------------------

/**
 * @openapi
 * /api-docs/swagger.json:
 *   get:
 *     tags:
 *       - Health
 *     summary: OpenAPI specification (JSON)
 *     description: Returns the raw OpenAPI 3.x specification as JSON.
 *     responses:
 *       200:
 *         description: OpenAPI spec document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get("/api-docs/swagger.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "VifeMS API Docs",
    swaggerOptions: {
      // Persist auth across page refreshes in dev.
      persistAuthorization: true,
    },
  })
);

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check
 *     description: >
 *       Confirms the server is running and accepting connections.
 *       Does not require authentication. Safe to use as a liveness probe.
 *     responses:
 *       200:
 *         description: Server is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               message: "VifeMS backend is running"
 */
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "VifeMS backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspaces/:workspaceId/financial", financialRoutes);

// ------------------------------------------------------------
// Error Handling (must be last)
// ------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
