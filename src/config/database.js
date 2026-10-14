// ============================================================
// VifeMS — Prisma Database Client
// src/config/database.js
//
// Exports a single shared PrismaClient instance for use
// across the entire application. Using a module-level
// singleton avoids creating multiple database connections.
// ============================================================

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Append connection pool settings to the DATABASE_URL so Prisma
// can survive transient drops from cloud-hosted Postgres (e.g. RumptyCloud).
const baseUrl = process.env.DATABASE_URL || "";
const datasourceUrl = baseUrl.includes("connection_limit")
  ? baseUrl
  : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}connection_limit=5&pool_timeout=15&connect_timeout=15`;

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["error", "warn"]
      : ["error"],
  datasources: {
    db: { url: datasourceUrl },
  },
});

// Gracefully release the connection pool on process exit.
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export default prisma;
