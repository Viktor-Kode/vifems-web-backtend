// ============================================================
// VifeMS — Workspace Provisioning & Operations Service
// src/services/workspaceService.js
//
// Manages workspace generation drafts, dynamic PostgreSQL table
// provisioning with foreign key relationships, and tenant-isolated
// record CRUD operations.
// ============================================================

import prisma from "../config/database.js";
import {
  generateWorkspaceBlueprint,
  validateBlueprint,
  sanitizeIdentifier,
  normalizeFieldType,
} from "./vifeAiService.js";
import crypto from "crypto";

const MAX_WORKSPACES_PER_USER = 25;
const MAX_MODULES_PER_WORKSPACE = 15;
const MAX_FIELDS_PER_MODULE = 30;

/**
 * Validates that an identifier strictly matches safe SQL naming rules.
 */
function assertSafeIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string" || !/^[a-z][a-z0-9_]{1,60}$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: "${identifier}"`);
  }
}

/**
 * Creates an AI workspace blueprint generation draft for an authenticated user.
 */
export async function createWorkspaceGeneration({ userId, description }) {
  if (!userId) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }

  const blueprint = await generateWorkspaceBlueprint(description);

  const generation = await prisma.workspaceGeneration.create({
    data: {
      userId,
      description: description.trim(),
      status: "REVIEW_READY",
      blueprint,
    },
  });

  return {
    generationId: generation.id,
    status: generation.status,
    blueprint,
  };
}

/**
 * Retrieves a generation draft, enforcing user ownership.
 */
export async function getWorkspaceGeneration({ generationId, userId }) {
  const generation = await prisma.workspaceGeneration.findUnique({
    where: { id: generationId },
  });

  if (!generation) {
    const error = new Error("Generation draft not found.");
    error.status = 404;
    throw error;
  }

  if (generation.userId !== userId) {
    const error = new Error("Access denied. You do not own this generation draft.");
    error.status = 403;
    throw error;
  }

  return {
    generationId: generation.id,
    status: generation.status,
    description: generation.description,
    blueprint: generation.blueprint,
    workspaceId: generation.workspaceId,
    createdAt: generation.createdAt,
  };
}

/**
 * Regenerates a blueprint from an existing generation draft.
 */
export async function regenerateWorkspaceGeneration({ generationId, userId }) {
  const draft = await getWorkspaceGeneration({ generationId, userId });

  const newBlueprint = await generateWorkspaceBlueprint(draft.description);

  const updated = await prisma.workspaceGeneration.update({
    where: { id: generationId },
    data: {
      blueprint: newBlueprint,
      status: "REVIEW_READY",
      errorMessage: null,
    },
  });

  return {
    generationId: updated.id,
    status: updated.status,
    blueprint: newBlueprint,
  };
}

/**
 * Provisions a workspace and its dynamic PostgreSQL module tables from a blueprint.
 */
export async function provisionWorkspace({ userId, generationId, blueprint }) {
  if (!userId) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }

  let generationDraft = null;
  if (generationId) {
    generationDraft = await prisma.workspaceGeneration.findUnique({
      where: { id: generationId },
    });

    if (!generationDraft) {
      const error = new Error("Generation draft not found.");
      error.status = 404;
      throw error;
    }

    if (generationDraft.userId !== userId) {
      const error = new Error("Access denied. You do not own this generation draft.");
      error.status = 403;
      throw error;
    }

    // Idempotency check: if draft was already provisioned, return existing workspace ID
    if (generationDraft.status === "COMPLETED" && generationDraft.workspaceId) {
      const existing = await prisma.workspace.findUnique({
        where: { id: generationDraft.workspaceId },
      });
      if (existing) {
        return {
          workspaceId: existing.id,
          status: existing.status,
          alreadyProvisioned: true,
        };
      }
    }
  }

  // Fallback to draft blueprint if none passed in request
  const blueprintToValidate = blueprint || generationDraft?.blueprint;
  if (!blueprintToValidate) {
    const error = new Error("Blueprint definition is required for provisioning.");
    error.status = 400;
    throw error;
  }

  // Server-side revalidation
  const validation = validateBlueprint(blueprintToValidate);
  if (!validation.valid) {
    const error = new Error(`Invalid blueprint: ${validation.errors.join(", ")}`);
    error.status = 400;
    throw error;
  }
  const cleanBlueprint = validation.normalized;

  // Platform limits check
  const userWorkspaceCount = await prisma.workspace.count({ where: { userId } });
  if (userWorkspaceCount >= MAX_WORKSPACES_PER_USER) {
    const error = new Error(`Workspace limit reached (${MAX_WORKSPACES_PER_USER} max).`);
    error.status = 400;
    throw error;
  }

  if (cleanBlueprint.modules.length > MAX_MODULES_PER_WORKSPACE) {
    const error = new Error(`Exceeded maximum modules per workspace (${MAX_MODULES_PER_WORKSPACE}).`);
    error.status = 400;
    throw error;
  }

  // Create Workspace Record
  const baseSlug = sanitizeIdentifier(cleanBlueprint.workspaceName || cleanBlueprint.name, "workspace");
  const randomSuffix = crypto.randomBytes(3).toString("hex");
  const workspaceSlug = `${baseSlug}_${randomSuffix}`;

  const workspace = await prisma.workspace.create({
    data: {
      userId,
      name: cleanBlueprint.workspaceName || cleanBlueprint.name,
      slug: workspaceSlug,
      description: cleanBlueprint.description,
      status: "ACTIVE",
      metadata: {
        relationships: cleanBlueprint.relationships || [],
      },
    },
  });

  const cleanWsId = workspace.id.replace(/[^a-z0-9]/gi, "").toLowerCase().substring(0, 16);
  const createdTableList = [];
  const moduleSlugToTable = new Map();

  try {
    // 1. Provision each physical module table
    for (let i = 0; i < cleanBlueprint.modules.length; i++) {
      const mod = cleanBlueprint.modules[i];
      const modSlug = sanitizeIdentifier(mod.slug || mod.id, `mod_${i + 1}`);

      // Safe physical table name: ws_<cleanWsId>_<modSlug>
      const tableName = `ws_${cleanWsId}_${modSlug}`.substring(0, 58);
      assertSafeIdentifier(tableName);
      createdTableList.push(tableName);
      moduleSlugToTable.set(modSlug, tableName);
      moduleSlugToTable.set(mod.id, tableName);

      // System-managed primary key and metadata columns
      const columnSqlParts = [
        `"id" VARCHAR(64) PRIMARY KEY`,
        `"workspace_id" VARCHAR(64) NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE`,
        `"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        `"updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        `"data" JSONB NOT NULL DEFAULT '{}'::jsonb`,
      ];

      const validModuleFields = [];

      for (let j = 0; j < Math.min(mod.fields.length, MAX_FIELDS_PER_MODULE); j++) {
        const field = mod.fields[j];
        const colName = sanitizeIdentifier(field.name || field.id, `col_${j + 1}`);
        assertSafeIdentifier(colName);

        const typeLower = normalizeFieldType(field.type);
        let colType = "TEXT";
        if (typeLower === "number" || typeLower === "currency") {
          colType = "NUMERIC(14, 2)";
        } else if (typeLower === "decimal") {
          colType = "NUMERIC(14, 4)";
        } else if (typeLower === "boolean") {
          colType = "BOOLEAN DEFAULT FALSE";
        } else if (typeLower === "date") {
          colType = "DATE";
        } else if (typeLower === "datetime") {
          colType = "TIMESTAMPTZ";
        } else if (typeLower === "relation") {
          colType = "VARCHAR(64)";
        }

        columnSqlParts.push(`"${colName}" ${colType}`);
        validModuleFields.push({
          ...field,
          name: colName,
          typeLower,
        });
      }

      // Safe dynamic table provisioning via PostgreSQL DDL
      const ddl = `
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          ${columnSqlParts.join(",\n          ")}
        );
      `;
      await prisma.$executeRawUnsafe(ddl);

      // Create index on workspace_id for high-performance tenant isolation
      const indexSql = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_ws" ON "${tableName}" ("workspace_id");`;
      await prisma.$executeRawUnsafe(indexSql);

      // Persist WorkspaceModule metadata
      await prisma.workspaceModule.create({
        data: {
          workspaceId: workspace.id,
          name: mod.name,
          slug: modSlug,
          tableName,
          description: mod.description,
          fields: validModuleFields,
          views: mod.views || ["table", "form"],
          relationships: cleanBlueprint.relationships?.filter(
            (r) =>
              r.fromEntityId === mod.id ||
              r.toEntityId === mod.id ||
              r.sourceModule === modSlug ||
              r.targetModule === modSlug
          ),
        },
      });
    }

    // 2. Add foreign key indexes and constraints between dynamic tables
    for (const mod of cleanBlueprint.modules) {
      const modSlug = sanitizeIdentifier(mod.slug || mod.id);
      const tableName = moduleSlugToTable.get(modSlug);
      if (!tableName) continue;

      for (const field of mod.fields) {
        if (normalizeFieldType(field.type) === "relation") {
          const colName = sanitizeIdentifier(field.name || field.id);
          const targetSlug = field.targetModule;
          const targetTable = moduleSlugToTable.get(targetSlug);

          // Index foreign key column for fast queries
          const idxName = `idx_${tableName}_${colName}`.substring(0, 60);
          await prisma.$executeRawUnsafe(
            `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${tableName}" ("${colName}");`
          );

          if (targetTable) {
            const fkName = `fk_${tableName}_${colName}`.substring(0, 60);
            try {
              await prisma.$executeRawUnsafe(`
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${fkName}') THEN
                    ALTER TABLE "${tableName}"
                    ADD CONSTRAINT "${fkName}"
                    FOREIGN KEY ("${colName}")
                    REFERENCES "${targetTable}"("id")
                    ON DELETE RESTRICT;
                  END IF;
                END $$;
              `);
            } catch (fkErr) {
              console.warn(`[Provisioning] Foreign key constraint notice on "${fkName}":`, fkErr.message);
            }
          }
        }
      }
    }

    // Update generation draft status if linked
    if (generationId) {
      await prisma.workspaceGeneration.update({
        where: { id: generationId },
        data: {
          status: "COMPLETED",
          workspaceId: workspace.id,
          errorMessage: null,
        },
      });
    }

    return {
      workspaceId: workspace.id,
      status: "ACTIVE",
    };
  } catch (err) {
    // Atomic rollback: clean up partially provisioned physical tables
    for (const tbl of createdTableList) {
      try {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tbl}" CASCADE;`);
      } catch (_) {}
    }

    if (generationId) {
      await prisma.workspaceGeneration.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          errorMessage: err.message,
        },
      }).catch(() => {});
    }

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { status: "FAILED" },
    }).catch(() => {});

    throw err;
  }
}

/**
 * Lists all workspaces belonging to an authenticated user.
 */
export async function listUserWorkspaces(userId) {
  return prisma.workspace.findMany({
    where: { userId },
    include: {
      modules: {
        select: {
          id: true,
          name: true,
          slug: true,
          fields: true,
          views: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Retrieves a single workspace with its modules and field metadata.
 * Enforces tenant ownership.
 */
export async function getWorkspaceById(workspaceId, userId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      modules: true,
    },
  });

  if (!workspace) {
    const error = new Error("Workspace not found.");
    error.status = 404;
    throw error;
  }

  if (workspace.userId !== userId) {
    const error = new Error("Access denied. You do not own this workspace.");
    error.status = 403;
    throw error;
  }

  return workspace;
}

/**
 * Updates the name (business name) of an existing workspace.
 * Enforces tenant ownership.
 */
export async function updateWorkspaceName(workspaceId, userId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    const error = new Error("Workspace name cannot be empty.");
    error.status = 400;
    throw error;
  }

  // Check ownership
  await getWorkspaceById(workspaceId, userId);

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: trimmed },
    include: {
      modules: true,
    },
  });
}

/**
 * Helper to fetch and verify module access.
 */
async function getAuthorizedModule(workspaceId, moduleIdOrSlug, userId) {
  await getWorkspaceById(workspaceId, userId);

  const mod = await prisma.workspaceModule.findFirst({
    where: {
      workspaceId,
      OR: [
        { id: moduleIdOrSlug },
        { slug: moduleIdOrSlug },
      ],
    },
  });

  if (!mod) {
    const error = new Error("Module not found in this workspace.");
    error.status = 404;
    throw error;
  }

  assertSafeIdentifier(mod.tableName);
  return mod;
}

/**
 * Validates and formats field values for insert/update operations.
 * Enforces cross-workspace isolation on relationships and data type semantics.
 */
async function validateAndCastFieldValue(f, rawVal, workspaceId) {
  const typeLower = f.typeLower || normalizeFieldType(f.type);
  const colName = f.name;

  if (rawVal === undefined || rawVal === null || rawVal === "") {
    if (f.required) {
      const error = new Error(`Field "${f.label || colName}" is required.`);
      error.status = 400;
      throw error;
    }
    return null;
  }

  // 1. Relation validation: check target record exists in the SAME workspace
  if (typeLower === "relation") {
    const targetSlug = f.targetModule || f.relatedEntityId;
    if (!targetSlug) {
      const error = new Error(`Relation field "${colName}" has no target module defined.`);
      error.status = 400;
      throw error;
    }

    const targetMod = await prisma.workspaceModule.findFirst({
      where: {
        workspaceId,
        OR: [{ id: targetSlug }, { slug: targetSlug }],
      },
    });

    if (!targetMod) {
      const error = new Error(`Target module "${targetSlug}" does not exist in this workspace.`);
      error.status = 400;
      throw error;
    }

    assertSafeIdentifier(targetMod.tableName);

    // Enforce tenant isolation & referential integrity
    const targetCheck = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "${targetMod.tableName}" WHERE "workspace_id" = $1 AND "id" = $2`,
      workspaceId,
      String(rawVal)
    );

    if (!targetCheck || targetCheck.length === 0) {
      const error = new Error(
        `Invalid reference: record "${rawVal}" does not exist in module "${targetMod.name}" within this workspace.`
      );
      error.status = 400;
      throw error;
    }

    return String(rawVal);
  }

  // 2. Select validation: check against allowed options
  if (typeLower === "select") {
    const stringVal = String(rawVal).trim();
    if (Array.isArray(f.options) && f.options.length > 0) {
      const matched = f.options.some((opt) => opt.toLowerCase() === stringVal.toLowerCase());
      if (!matched) {
        const error = new Error(
          `Invalid option "${rawVal}" for field "${f.label || colName}". Allowed options: ${f.options.join(", ")}`
        );
        error.status = 400;
        throw error;
      }
    }
    return stringVal;
  }

  // 3. Number, Decimal, Currency validation
  if (typeLower === "number" || typeLower === "decimal" || typeLower === "currency") {
    const num = Number(rawVal);
    if (isNaN(num) || !isFinite(num)) {
      const error = new Error(`Field "${f.label || colName}" must be a valid number.`);
      error.status = 400;
      throw error;
    }
    return num;
  }

  // 4. Boolean validation
  if (typeLower === "boolean") {
    return Boolean(rawVal === true || rawVal === "true" || rawVal === 1);
  }

  // 5. Date & Datetime validation
  if (typeLower === "date" || typeLower === "datetime") {
    const parsed = new Date(rawVal);
    if (isNaN(parsed.getTime())) {
      const error = new Error(`Field "${f.label || colName}" must be a valid date.`);
      error.status = 400;
      throw error;
    }
    return parsed;
  }

  // 6. Email validation
  if (typeLower === "email") {
    const emailStr = String(rawVal).trim();
    if (emailStr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      const error = new Error(`Field "${f.label || colName}" must be a valid email address.`);
      error.status = 400;
      throw error;
    }
    return emailStr;
  }

  return String(rawVal);
}

/**
 * Lists records for a module in a workspace (with pagination and tenant isolation).
 */
export async function listRecords({ workspaceId, moduleId, userId, page = 1, limit = 50, search = "" }) {
  const mod = await getAuthorizedModule(workspaceId, moduleId, userId);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const trimmedSearch = typeof search === "string" ? search.trim() : "";
  let countResult;
  let records;

  if (trimmedSearch) {
    const searchPattern = `%${trimmedSearch}%`;
    countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${mod.tableName}" WHERE "workspace_id" = $1 AND "data"::text ILIKE $2`,
      workspaceId,
      searchPattern
    );
    records = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${mod.tableName}" WHERE "workspace_id" = $1 AND "data"::text ILIKE $2 ORDER BY "created_at" DESC LIMIT $3 OFFSET $4`,
      workspaceId,
      searchPattern,
      limitNum,
      offset
    );
  } else {
    // Total count query
    countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${mod.tableName}" WHERE "workspace_id" = $1`,
      workspaceId
    );
    // Records query
    records = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${mod.tableName}" WHERE "workspace_id" = $1 ORDER BY "created_at" DESC LIMIT $2 OFFSET $3`,
      workspaceId,
      limitNum,
      offset
    );
  }

  const total = countResult[0]?.count || 0;

  return {
    records,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
    module: {
      id: mod.id,
      name: mod.name,
      slug: mod.slug,
      fields: mod.fields,
    },
  };
}

/**
 * Creates a record in a dynamic module table.
 */
export async function createRecord({ workspaceId, moduleId, userId, data }) {
  const mod = await getAuthorizedModule(workspaceId, moduleId, userId);

  if (!data || typeof data !== "object") {
    const error = new Error("Record data must be a valid object.");
    error.status = 400;
    throw error;
  }

  const recordId = `rec_${crypto.randomBytes(12).toString("hex")}`;
  const fields = mod.fields || [];

  const columns = ['"id"', '"workspace_id"', '"created_at"', '"updated_at"', '"data"'];
  const values = [recordId, workspaceId, new Date(), new Date(), JSON.stringify(data)];
  const placeholders = ["$1", "$2", "$3", "$4", "$5::jsonb"];

  let paramIdx = 6;
  for (const f of fields) {
    const colName = f.name;
    assertSafeIdentifier(colName);

    let rawVal = data[colName];
    if ((rawVal === undefined || rawVal === null || rawVal === "") && data.full_name) {
      if (colName === "first_name") {
        rawVal = data.full_name.trim().split(/\s+/)[0];
      } else if (colName === "last_name") {
        const parts = data.full_name.trim().split(/\s+/);
        rawVal = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
      }
    } else if ((rawVal === undefined || rawVal === null || rawVal === "") && (data.first_name || data.last_name)) {
      if (colName === "full_name") {
        rawVal = [data.first_name, data.last_name].filter(Boolean).join(" ");
      }
    }

    const validatedVal = await validateAndCastFieldValue(f, rawVal, workspaceId);

    if (validatedVal !== null) {
      columns.push(`"${colName}"`);
      placeholders.push(`$${paramIdx++}`);
      values.push(validatedVal);
    }
  }

  const insertSql = `
    INSERT INTO "${mod.tableName}" (${columns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *;
  `;

  const result = await prisma.$queryRawUnsafe(insertSql, ...values);
  return result[0];
}

/**
 * Retrieves a single record.
 */
export async function getRecord({ workspaceId, moduleId, userId, recordId }) {
  const mod = await getAuthorizedModule(workspaceId, moduleId, userId);

  const records = await prisma.$queryRawUnsafe(
    `SELECT * FROM "${mod.tableName}" WHERE "workspace_id" = $1 AND "id" = $2`,
    workspaceId,
    recordId
  );

  if (!records || records.length === 0) {
    const error = new Error("Record not found.");
    error.status = 404;
    throw error;
  }

  return records[0];
}

/**
 * Updates a record in a dynamic module table.
 */
export async function updateRecord({ workspaceId, moduleId, userId, recordId, data }) {
  const mod = await getAuthorizedModule(workspaceId, moduleId, userId);

  const existing = await getRecord({ workspaceId, moduleId, userId, recordId });
  if (!existing) {
    const error = new Error("Record not found.");
    error.status = 404;
    throw error;
  }

  const setClauses = ['"updated_at" = NOW()'];
  const values = [workspaceId, recordId];
  let paramIdx = 3;

  const mergedData = { ...(existing.data || {}), ...data };
  setClauses.push(`"data" = $${paramIdx++}::jsonb`);
  values.push(JSON.stringify(mergedData));

  const fields = mod.fields || [];
  for (const f of fields) {
    const colName = f.name;
    assertSafeIdentifier(colName);

    let rawVal = data[colName];
    if ((rawVal === undefined || rawVal === null || rawVal === "") && data.full_name) {
      if (colName === "first_name") {
        rawVal = data.full_name.trim().split(/\s+/)[0];
      } else if (colName === "last_name") {
        const parts = data.full_name.trim().split(/\s+/);
        rawVal = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
      }
    } else if ((rawVal === undefined || rawVal === null || rawVal === "") && (data.first_name || data.last_name)) {
      if (colName === "full_name") {
        rawVal = [data.first_name, data.last_name].filter(Boolean).join(" ");
      }
    }

    if (rawVal !== undefined) {
      if (rawVal === null) {
        if (f.required) {
          const error = new Error(`Field "${f.label || colName}" is required.`);
          error.status = 400;
          throw error;
        }
        setClauses.push(`"${colName}" = NULL`);
      } else {
        const validatedVal = await validateAndCastFieldValue(f, rawVal, workspaceId);
        setClauses.push(`"${colName}" = $${paramIdx++}`);
        values.push(validatedVal);
      }
    }
  }

  const updateSql = `
    UPDATE "${mod.tableName}"
    SET ${setClauses.join(", ")}
    WHERE "workspace_id" = $1 AND "id" = $2
    RETURNING *;
  `;

  const result = await prisma.$queryRawUnsafe(updateSql, ...values);
  return result[0];
}

/**
 * Deletes a record, enforcing foreign key integrity.
 */
export async function deleteRecord({ workspaceId, moduleId, userId, recordId }) {
  const mod = await getAuthorizedModule(workspaceId, moduleId, userId);

  try {
    const deleted = await prisma.$queryRawUnsafe(
      `DELETE FROM "${mod.tableName}" WHERE "workspace_id" = $1 AND "id" = $2 RETURNING "id"`,
      workspaceId,
      recordId
    );

    if (!deleted || deleted.length === 0) {
      const error = new Error("Record not found.");
      error.status = 404;
      throw error;
    }

    return { success: true, id: recordId };
  } catch (err) {
    if (err.code === "23503" || err.message?.includes("foreign key") || err.message?.includes("violates foreign key")) {
      const error = new Error("Cannot delete record because it is referenced by other records in the workspace.");
      error.status = 400;
      throw error;
    }
    throw err;
  }
}

/**
 * Generates schema-aware overview metrics and recent activity for a workspace.
 * Queries PostgreSQL directly with COUNT and LIMIT queries without dumping entire database.
 */
export async function getWorkspaceOverview({ workspaceId, userId }) {
  const workspace = await getWorkspaceById(workspaceId, userId);
  const modules = workspace.modules || [];

  let totalRecords = 0;
  const moduleStats = [];
  const recentActivity = [];

  for (const mod of modules) {
    assertSafeIdentifier(mod.tableName);

    // Get count for module
    const countRes = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${mod.tableName}" WHERE "workspace_id" = $1`,
      workspaceId
    );
    const count = countRes[0]?.count || 0;
    totalRecords += count;

    // Get recent records (up to 5)
    const recent = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${mod.tableName}" WHERE "workspace_id" = $1 ORDER BY "created_at" DESC LIMIT 5`,
      workspaceId
    );

    moduleStats.push({
      moduleId: mod.id,
      moduleSlug: mod.slug,
      moduleName: mod.name,
      recordCount: count,
    });

    const fields = Array.isArray(mod.fields) ? mod.fields : [];
    const labelField =
      fields.find((f) =>
        ["name", "full_name", "title", "label", "number", "item_name", "client_name", "customer_name"].includes(f.name)
      ) || fields[0];

    for (const rec of recent) {
      let recLabel = labelField ? rec[labelField.name] : null;
      if (!recLabel && rec.data && typeof rec.data === "object") {
        recLabel = labelField ? rec.data[labelField.name] : null;
      }
      if (!recLabel) {
        recLabel = rec.id;
      }

      recentActivity.push({
        recordId: rec.id,
        moduleId: mod.id,
        moduleSlug: mod.slug,
        moduleName: mod.name,
        label: String(recLabel),
        action: "Created",
        timestamp: rec.created_at,
      });
    }
  }

  // Sort recent activity across all modules by timestamp descending
  recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    totalRecords,
    moduleStats,
    recentActivity: recentActivity.slice(0, 10),
  };
}

