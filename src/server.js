// ============================================================
// VifeMS — Server Entry Point
// src/server.js
//
// Binds the Express application to a port and starts
// listening. This is the only file that knows the port —
// app.js is purely about middleware and route configuration.
// ============================================================

import http from "http";
import https from "https";
import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { verifyEmailTransport } from "./services/emailService.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n✅ VifeMS backend running on http://localhost:${PORT}`);
  console.log(`📖 API Docs:          http://localhost:${PORT}/api-docs`);
  console.log(`🩺 Health check:      http://localhost:${PORT}/api/health\n`);

  // Verify SMTP connectivity after the server starts.
  // A failure here does NOT abort the server — email is non-critical for boot.
  verifyEmailTransport()
    .then(() => {
      console.log("📧 SMTP connection verified.");
    })
    .catch((err) => {
      // Log a safe, generic message — no credentials exposed.
      console.warn(`⚠️  SMTP connection failed: ${err.message}`);
      console.warn("   Password reset emails will not be delivered until SMTP is configured correctly.");
    });

  // Keep-alive self-ping for free-tier / sleeping hosting
  const BACKEND_URL = process.env.BACKEND_URL || "https://vifems-backend.rumptycloud.app";
  if (BACKEND_URL && process.env.NODE_ENV === "production") {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 mins
    const client = BACKEND_URL.startsWith("https") ? https : http;

    console.log(`⏱️  Keep-alive self-ping scheduled for ${BACKEND_URL}/api/health every 14 minutes.`);
    setInterval(() => {
      client
        .get(`${BACKEND_URL}/api/health`, (res) => {
          console.log(`📡 Self-ping status: ${res.statusCode}`);
        })
        .on("error", (err) => {
          console.error(`⚠️  Self-ping failed:`, err.message);
        });
    }, PING_INTERVAL);
  }
});