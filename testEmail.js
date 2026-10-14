import { sendWelcomeEmail } from "./src/services/emailService.js";

async function testEmail() {
  try {
    await sendWelcomeEmail({ to: "test@example.com", fullName: "Test User" });
    console.log("Success");
  } catch (err) {
    console.error("Error:", err);
  }
}

testEmail();
