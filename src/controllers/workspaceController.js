// ============================================================
// VifeMS — Workspace Controller
// src/controllers/workspaceController.js
//
// Handles HTTP request parsing, validation, and response
// serialization for workspace blueprint generation, provisioning,
// and dynamic records operations.
// ============================================================

import {
  createWorkspaceGeneration,
  getWorkspaceGeneration,
  regenerateWorkspaceGeneration,
  provisionWorkspace,
  listUserWorkspaces,
  getWorkspaceById,
  listRecords,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
  getWorkspaceOverview,
  updateWorkspaceName,
} from "../services/workspaceService.js";

/**
 * POST /api/workspaces/generate
 * Generates an AI workspace blueprint from natural language business description.
 */
export async function generateWorkspaceController(req, res, next) {
  try {
    const { description } = req.body || {};

    if (!description || typeof description !== "string") {
      return res.status(400).json({
        success: false,
        message: "Business description is required.",
      });
    }

    const trimmed = description.trim();
    if (trimmed.length < 50) {
      return res.status(400).json({
        success: false,
        message: "Business description must be at least 50 characters.",
      });
    }

    if (trimmed.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Business description cannot exceed 5000 characters.",
      });
    }

    const result = await createWorkspaceGeneration({
      userId: req.user.id,
      description: trimmed,
    });

    res.status(201).json({
      success: true,
      data: {
        generationId: result.generationId,
        status: result.status,
        blueprint: result.blueprint,
      },
      generationId: result.generationId,
      blueprint: result.blueprint,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces/generations/:generationId
 * Retrieves a generation draft for review.
 */
export async function getGenerationController(req, res, next) {
  try {
    const { generationId } = req.params;
    const result = await getWorkspaceGeneration({
      generationId,
      userId: req.user.id,
    });

    res.json({
      success: true,
      data: result,
      blueprint: result.blueprint,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/workspaces/generations/:generationId/regenerate
 * Regenerates the blueprint for an existing generation draft.
 */
export async function regenerateGenerationController(req, res, next) {
  try {
    const { generationId } = req.params;
    const result = await regenerateWorkspaceGeneration({
      generationId,
      userId: req.user.id,
    });

    res.json({
      success: true,
      data: result,
      generationId: result.generationId,
      blueprint: result.blueprint,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/workspaces/generations/:generationId/launch
 * Launches and provisions dynamic PostgreSQL tables from a reviewed blueprint draft.
 */
export async function launchGenerationController(req, res, next) {
  try {
    const { generationId } = req.params;
    const { blueprint } = req.body || {};

    const result = await provisionWorkspace({
      userId: req.user.id,
      generationId,
      blueprint,
    });

    res.status(200).json({
      success: true,
      data: {
        workspaceId: result.workspaceId,
        status: result.status,
        nextUrl: `/dashboard?workspaceId=${result.workspaceId}`,
      },
      workspaceId: result.workspaceId,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/workspaces/provision
 * Direct provisioning endpoint for compatibility with frontend workspace client.
 */
export async function provisionDirectController(req, res, next) {
  try {
    const { blueprint, generationId } = req.body || {};

    const result = await provisionWorkspace({
      userId: req.user.id,
      generationId,
      blueprint,
    });

    res.status(200).json({
      success: true,
      workspaceId: result.workspaceId,
      data: {
        workspaceId: result.workspaceId,
        status: result.status,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces
 * Lists workspaces for the authenticated user.
 */
export async function listWorkspacesController(req, res, next) {
  try {
    const workspaces = await listUserWorkspaces(req.user.id);
    res.json({
      success: true,
      data: workspaces,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces/:workspaceId
 * Retrieves a single workspace with its module definitions.
 */
export async function getWorkspaceController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const workspace = await getWorkspaceById(workspaceId, req.user.id);

    res.json({
      success: true,
      data: workspace,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/workspaces/:workspaceId
 * Updates workspace properties (e.g. name / business name).
 */
export async function updateWorkspaceController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const { name } = req.body || {};

    const updated = await updateWorkspaceName(workspaceId, req.user.id, name);

    res.json({
      success: true,
      data: updated,
      message: "Workspace updated successfully.",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces/:workspaceId/overview
 * Retrieves schema-aware metrics and recent activity for a workspace.
 */
export async function getWorkspaceOverviewController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const overview = await getWorkspaceOverview({
      workspaceId,
      userId: req.user.id,
    });

    res.json({
      success: true,
      data: overview,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces/:workspaceId/modules/:moduleId/records
 * Lists records for a module.
 */
export async function listRecordsController(req, res, next) {
  try {
    const { workspaceId, moduleId } = req.params;
    const { page, limit, search } = req.query;

    const result = await listRecords({
      workspaceId,
      moduleId,
      userId: req.user.id,
      page,
      limit,
      search,
    });

    res.json({
      success: true,
      data: result.records,
      pagination: result.pagination,
      module: result.module,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/workspaces/:workspaceId/modules/:moduleId/records
 * Creates a record in a dynamic module table.
 */
export async function createRecordController(req, res, next) {
  try {
    const { workspaceId, moduleId } = req.params;
    const data = req.body;

    const record = await createRecord({
      workspaceId,
      moduleId,
      userId: req.user.id,
      data,
    });

    res.status(201).json({
      success: true,
      data: record,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/workspaces/:workspaceId/modules/:moduleId/records/:recordId
 * Retrieves a single record.
 */
export async function getRecordController(req, res, next) {
  try {
    const { workspaceId, moduleId, recordId } = req.params;

    const record = await getRecord({
      workspaceId,
      moduleId,
      userId: req.user.id,
      recordId,
    });

    res.json({
      success: true,
      data: record,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/workspaces/:workspaceId/modules/:moduleId/records/:recordId
 * Updates a record.
 */
export async function updateRecordController(req, res, next) {
  try {
    const { workspaceId, moduleId, recordId } = req.params;
    const data = req.body;

    const updated = await updateRecord({
      workspaceId,
      moduleId,
      userId: req.user.id,
      recordId,
      data,
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/workspaces/:workspaceId/modules/:moduleId/records/:recordId
 * Deletes a record.
 */
export async function deleteRecordController(req, res, next) {
  try {
    const { workspaceId, moduleId, recordId } = req.params;

    const result = await deleteRecord({
      workspaceId,
      moduleId,
      userId: req.user.id,
      recordId,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}
