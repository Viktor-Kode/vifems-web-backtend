// ============================================================
// VifeMS — Workspace Routes
// src/routes/workspaceRoutes.js
//
// API endpoints for AI workspace blueprint generation,
// review, dynamic provisioning, and record CRUD.
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  generateWorkspaceController,
  getGenerationController,
  regenerateGenerationController,
  launchGenerationController,
  provisionDirectController,
  listWorkspacesController,
  getWorkspaceController,
  updateWorkspaceController,
  listRecordsController,
  createRecordController,
  getRecordController,
  updateRecordController,
  deleteRecordController,
  getWorkspaceOverviewController,
} from "../controllers/workspaceController.js";
import financialRoutes from "./financialRoutes.js";

const router = Router();

// Rate limiting for AI blueprint generation (protects compute/AI API quotas)
const aiGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 blueprint generations per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many workspace generation requests. Please try again shortly.",
  },
});

// All workspace routes require an authenticated user
router.use(requireAuth);

/**
 * @openapi
 * /api/workspaces/generate:
 *   post:
 *     tags:
 *       - Workspaces
 *     summary: Generate an AI workspace blueprint
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description]
 *             properties:
 *               description:
 *                 type: string
 *                 minLength: 50
 *                 maxLength: 5000
 *     responses:
 *       201:
 *         description: Workspace blueprint generated successfully.
 */
router.post("/generate", aiGenerationLimiter, generateWorkspaceController);

/**
 * @openapi
 * /api/workspaces/generations/{generationId}:
 *   get:
 *     tags:
 *       - Workspaces
 *     summary: Retrieve generation draft for review
 *     security:
 *       - cookieAuth: []
 */
router.get("/generations/:generationId", getGenerationController);

/**
 * @openapi
 * /api/workspaces/generations/{generationId}/regenerate:
 *   post:
 *     tags:
 *       - Workspaces
 *     summary: Regenerate workspace blueprint from draft
 *     security:
 *       - cookieAuth: []
 */
router.post("/generations/:generationId/regenerate", aiGenerationLimiter, regenerateGenerationController);

/**
 * @openapi
 * /api/workspaces/generations/{generationId}/launch:
 *   post:
 *     tags:
 *       - Workspaces
 *     summary: Launch and provision dynamic tables from reviewed blueprint
 *     security:
 *       - cookieAuth: []
 */
router.post("/generations/:generationId/launch", launchGenerationController);

/**
 * @openapi
 * /api/workspaces/provision:
 *   post:
 *     tags:
 *       - Workspaces
 *     summary: Direct workspace provisioning
 *     security:
 *       - cookieAuth: []
 */
router.post("/provision", provisionDirectController);

/**
 * @openapi
 * /api/workspaces:
 *   get:
 *     tags:
 *       - Workspaces
 *     summary: List authenticated user's workspaces
 *     security:
 *       - cookieAuth: []
 */
router.get("/", listWorkspacesController);

/**
 * @openapi
 * /api/workspaces/{workspaceId}:
 *   get:
 *     tags:
 *       - Workspaces
 *     summary: Retrieve workspace metadata and modules
 *     security:
 *       - cookieAuth: []
 */
router.get("/:workspaceId", getWorkspaceController);
router.patch("/:workspaceId", updateWorkspaceController);
router.get("/:workspaceId/overview", getWorkspaceOverviewController);

// Financial Document Engine (Invoices, Confirmed Payments, Receipts)
router.use("/:workspaceId/financial", financialRoutes);

/**
 * @openapi
 * /api/workspaces/{workspaceId}/modules/{moduleId}/records:
 *   get:
 *     tags:
 *       - Workspaces
 *     summary: List records for a module
 *     security:
 *       - cookieAuth: []
 *   post:
 *     tags:
 *       - Workspaces
 *     summary: Create record in a module
 *     security:
 *       - cookieAuth: []
 */
router.get("/:workspaceId/modules/:moduleId/records", listRecordsController);
router.post("/:workspaceId/modules/:moduleId/records", createRecordController);

/**
 * @openapi
 * /api/workspaces/{workspaceId}/modules/{moduleId}/records/{recordId}:
 *   get:
 *     tags:
 *       - Workspaces
 *     summary: Get record by ID
 *     security:
 *       - cookieAuth: []
 *   patch:
 *     tags:
 *       - Workspaces
 *     summary: Update record
 *     security:
 *       - cookieAuth: []
 *   delete:
 *     tags:
 *       - Workspaces
 *     summary: Delete record
 *     security:
 *       - cookieAuth: []
 */
router.get("/:workspaceId/modules/:moduleId/records/:recordId", getRecordController);
router.patch("/:workspaceId/modules/:moduleId/records/:recordId", updateRecordController);
router.delete("/:workspaceId/modules/:moduleId/records/:recordId", deleteRecordController);

export default router;
