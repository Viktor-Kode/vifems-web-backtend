import dotenv from "dotenv";
dotenv.config();

import passport from "./src/config/passport.js";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

// Check if strategy is registered
const strategies = passport._strategies;
console.log("Registered passport strategies:", Object.keys(strategies));
console.log("\nEnv vars check:");
console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.slice(0, 20)}...` : "MISSING");
console.log("GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? `${process.env.GOOGLE_CLIENT_SECRET.slice(0, 10)}...` : "MISSING");
console.log("GOOGLE_CALLBACK_URL:", process.env.GOOGLE_CALLBACK_URL || "MISSING");
