// ============================================================
// VifeMS — Swagger / OpenAPI Configuration
// src/docs/swagger.js
//
// Generates the OpenAPI 3.x specification using swagger-jsdoc.
// JSDoc @openapi annotations are written directly in the route
// and controller files so documentation stays close to the code.
//
// The spec is served as interactive UI at GET /api-docs and
// as raw JSON at GET /api-docs/swagger.json.
// ============================================================

import swaggerJsdoc from "swagger-jsdoc";
import { createRequire } from "module";

// Read package.json for version/description metadata.
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "VifeMS API",
      version: pkg.version,
      description: `
## VifeMS — AI-Native Business Management Platform

This is the official API reference for the VifeMS backend.

### Authentication
VifeMS uses **HTTP-only cookie authentication**. After a successful \`POST /api/auth/login\`,
an \`authToken\` cookie is set automatically by the browser. All subsequent requests to
protected endpoints will include this cookie.

> **Note:** Swagger UI cannot send HTTP-only cookies cross-origin directly.
> Use a REST client such as Postman or cURL with \`--cookie-jar\` for testing protected endpoints.

### Response Format
All endpoints return a consistent JSON envelope:
\`\`\`json
{ "success": true, "message": "...", "data": {} }
\`\`\`
Errors follow:
\`\`\`json
{ "success": false, "message": "Human readable message" }
\`\`\`
      `.trim(),
      contact: {
        name: "VifeMS Team",
      },
      license: {
        name: "ISC",
      },
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5000}`,
        description: "Local development server",
      },
    ],
    tags: [
      {
        name: "Health",
        description: "Server health and status checks",
      },
      {
        name: "Authentication",
        description:
          "User registration, login, logout, and session management",
      },
      {
        name: "Workspaces",
        description:
          "AI blueprint generation, workspace provisioning, and dynamic data records",
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "authToken",
          description:
            "HTTP-only JWT cookie set automatically on login. Cannot be sent manually via Swagger UI.",
        },
      },
      schemas: {
        // --- Request schemas ---
        RegisterRequest: {
          type: "object",
          required: ["fullName", "email", "password"],
          properties: {
            fullName: {
              type: "string",
              minLength: 2,
              example: "Victor Dosunmu",
              description: "The user's full name.",
            },
            email: {
              type: "string",
              format: "email",
              example: "victor@example.com",
              description: "A valid, unique email address.",
            },
            password: {
              type: "string",
              minLength: 8,
              example: "securePassword123",
              description: "Minimum 8 characters. Stored as a bcrypt hash.",
            },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: {
              type: "string",
              format: "email",
              example: "victor@example.com",
            },
            password: {
              type: "string",
              example: "securePassword123",
            },
          },
        },

        // --- Data schemas ---
        User: {
          type: "object",
          properties: {
            id: {
              type: "string",
              example: "clxyz123abc",
              description: "Unique CUID identifier.",
            },
            fullName: {
              type: "string",
              example: "Victor Dosunmu",
            },
            email: {
              type: "string",
              format: "email",
              example: "victor@example.com",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              example: "2026-10-03T12:00:00.000Z",
            },
          },
        },

        // --- Response envelopes ---
        AuthUserResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful." },
            data: {
              type: "object",
              properties: {
                user: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful." },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: {
              type: "string",
              example: "A human-readable error message.",
            },
          },
        },
      },
      responses: {
        InternalServerError: {
          description: "Unexpected server error.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                success: false,
                message: "An unexpected error occurred.",
              },
            },
          },
        },
      },
    },
  },
  // Scan these files for @openapi JSDoc annotations.
  apis: ["./src/controllers/*.js", "./src/routes/*.js", "./src/app.js"],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
