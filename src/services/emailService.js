// ============================================================
// VifeMS — Email Service
// src/services/emailService.js
//
// Abstraction for sending emails. Keeps the authentication
// and business logic decoupled from the actual email provider.
//
// Delivery: Nodemailer → Gmail SMTP (port 465, SSL)
// Credentials are read exclusively from environment variables.
// ============================================================

import nodemailer from "nodemailer";

// ---------------------------------------------------------------------------
// Transporter — created once at module load time.
// All credentials come from environment variables; nothing is hardcoded.
// ---------------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ---------------------------------------------------------------------------
// verifyEmailTransport
//
// Checks whether Nodemailer can authenticate with the SMTP server.
// Called once after the HTTP server starts — a failure does NOT abort boot.
// ---------------------------------------------------------------------------
export async function verifyEmailTransport() {
  await transporter.verify();
}

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
//
// Sends a password-reset email (HTML + plain-text) to the given address.
//
// @param {string} email    - Recipient's email address.
// @param {string} resetUrl - The full reset URL (raw token already embedded
//                            by the caller; never generated here).
// @returns {Promise<void>}
// @throws {Error}          - If SMTP delivery fails (with a safe message).
// ---------------------------------------------------------------------------
export async function sendPasswordResetEmail(email, resetUrl) {
  const expiresMinutes = parseInt(
    process.env.PASSWORD_RESET_EXPIRES_MINUTES || "30",
    10
  );
  const from = process.env.EMAIL_FROM || "VifeMS <noreply@vifems.com>";

  // ── Plain-text body ────────────────────────────────────────────────────
  const textBody = [
    "VifeMS — Password Reset Request",
    "",
    "We received a request to reset the password for your VifeMS account.",
    "",
    "Click the link below to reset your password:",
    resetUrl,
    "",
    `This link will expire in ${expiresMinutes} minutes.`,
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "Your password will not change.",
    "",
    "— The VifeMS Team",
  ].join("\n");

  // ── HTML body ──────────────────────────────────────────────────────────
  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your VifeMS password</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:32px 40px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">VifeMS</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#111827;">Reset your password</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6;">
                We received a request to reset the password for your VifeMS account.
                Click the button below to choose a new password.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:6px;background-color:#4f46e5;">
                    <a href="${resetUrl}"
                       target="_blank"
                       style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                Or copy and paste this URL into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:12px;color:#4f46e5;word-break:break-all;">
                ${resetUrl}
              </p>

              <!-- Expiry notice -->
              <p style="margin:0 0 24px;font-size:13px;color:#6b7280;line-height:1.5;">
                ⏱ This link will expire in <strong>${expiresMinutes} minutes</strong>.
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

              <!-- Security notice -->
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">
                If you did not request a password reset, you can safely ignore this email.
                Your password will not be changed.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${new Date().getFullYear()} VifeMS. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from,
      to: email,
      subject: "Reset your VifeMS password",
      text: textBody,
      html: htmlBody,
    });

    console.log(`[Email Service] Password reset email sent successfully to ${email}.`);
  } catch (err) {
    // Log a safe error — no credentials, no tokens, no URLs.
    console.error(`[Email Service] Failed to send password reset email: ${err.message}`);

    const sendErr = new Error("Failed to send password reset email. Please try again later.");
    sendErr.code = "EMAIL_SEND_FAILED";
    throw sendErr;
  }
}

// ---------------------------------------------------------------------------
// sendWelcomeEmail
//
// Sends a welcome email (HTML + plain-text) to a newly registered user.
// Uses the shared transporter — no second SMTP connection is created.
//
// @param {object} params
// @param {string} params.to       - Recipient's email address.
// @param {string} params.fullName - User's full name for personalisation.
// @returns {Promise<void>}
// @throws {Error}                 - If SMTP delivery fails (safe message only).
// ---------------------------------------------------------------------------
export async function sendWelcomeEmail({ to, fullName }) {
  const from = process.env.EMAIL_FROM || "VifeMS <noreply@vifems.com>";
  const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
  const dashboardUrl = `${clientUrl}/dashboard`;

  // Extract first name for the greeting (fall back to full name if single word).
  const firstName = fullName ? fullName.trim().split(/\s+/)[0] : "there";

  // ── Plain-text body ──────────────────────────────────────────────────────
  const textBody = [
    `Welcome to VifeMS, ${firstName}.`,
    "",
    "Your VifeMS account has been created successfully.",
    "",
    "VifeMS helps you create and manage a business workspace based on how your business operates.",
    "",
    "You can now sign in and start setting up your workspace:",
    dashboardUrl,
    "",
    "If you did not create this account, you can safely ignore this email.",
    "",
    "— The VifeMS Team",
  ].join("\n");

  // ── HTML body ────────────────────────────────────────────────────────────
  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to VifeMS</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:32px 40px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">VifeMS</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#111827;">Welcome to VifeMS, ${firstName}.</h1>
              <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.6;">
                Your VifeMS account has been created successfully.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.6;">
                VifeMS helps you create and manage a business workspace based on how your business operates.
                Sign in to get started.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="border-radius:6px;background-color:#4f46e5;">
                    <a href="${dashboardUrl}"
                       target="_blank"
                       style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
                      Open VifeMS
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

              <!-- Security notice -->
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">
                If you did not create a VifeMS account, you can safely ignore this email.
                No action is required.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${new Date().getFullYear()} VifeMS. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from,
    to,
    subject: "Welcome to VifeMS",
    text: textBody,
    html: htmlBody,
  });

  console.log(`[Email Service] Welcome email sent successfully to ${to}.`);
}
