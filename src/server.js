// ============================================================
// VifeMS — Server Entry Point
// src/server.js
//
// Binds the Express application to a port and starts
// listening. This is the only file that knows the port —
// app.js is purely about middleware and route configuration.
// ============================================================

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
});