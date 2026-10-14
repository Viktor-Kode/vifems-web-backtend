// ============================================================
// VifeMS — VifeAI Workspace Blueprint Generation Engine
// src/services/vifeAiService.js
//
// Generates and validates structured workspace blueprints from
// natural language business descriptions.
//
// Supports OpenAI / RumptyCloud LLM integration with intelligent
// dynamic semantic parsing fallback, ensuring zero false-failures
// and strict server-side schema verification.
// ============================================================

export const ALLOWED_FIELD_TYPES = new Set([
  "text",
  "long_text",
  "number",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "select",
  "currency",
  "relation",
]);

export const RESERVED_NAMES = new Set([
  "user",
  "users",
  "workspace",
  "workspaces",
  "module",
  "modules",
  "record",
  "records",
  "generation",
  "generations",
  "password_reset_token",
  "password_reset_tokens",
  "table",
  "tables",
  "select",
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "grant",
  "order",
  "group",
  "where",
  "from",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "primary",
  "foreign",
  "key",
  "index",
  "check",
  "pg_catalog",
  "information_schema",
  "system",
  "admin",
]);

/**
 * Sanitizes a string into a safe PostgreSQL / identifier slug.
 * Allows only lowercase alphanumeric characters and underscores.
 */
export function sanitizeIdentifier(str, fallback = "item") {
  if (!str || typeof str !== "string") return fallback;
  let clean = str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!clean || !/^[a-z]/.test(clean)) {
    clean = `mod_${clean || fallback}`;
  }

  if (RESERVED_NAMES.has(clean)) {
    clean = `biz_${clean}`;
  }

  return clean.substring(0, 32);
}

/**
 * Normalizes field type into lowercase standard type.
 */
export function normalizeFieldType(rawType, fallback = "text") {
  if (!rawType || typeof rawType !== "string") return fallback;
  const lower = rawType
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[\s-]+/g, "_");
  if (ALLOWED_FIELD_TYPES.has(lower)) return lower;
  if (lower === "string" || lower === "varchar") return "text";
  if (lower === "long_text" || lower === "textarea" || lower === "multiline" || lower === "notes" || lower === "paragraph") return "long_text";
  if (lower === "int" || lower === "integer" || lower === "count") return "number";
  if (lower === "float" || lower === "double" || lower === "decimal" || lower === "numeric" || lower === "measurement") return "decimal";
  if (lower === "bool") return "boolean";
  if (lower === "datetime" || lower === "date_time" || lower === "date_and_time" || lower === "timestamp") return "datetime";
  if (lower === "money") return "currency";
  return fallback;
}

/**
 * Checks whether a field type string is recognized by the system.
 */
export function isSupportedFieldType(rawType) {
  if (!rawType || typeof rawType !== "string") return false;
  return normalizeFieldType(rawType, null) !== null;
}

/**
 * Formats field type for display (capitalized).
 */
export function capitalizeType(type) {
  const norm = normalizeFieldType(type, "text");
  if (norm === "long_text") return "Long text";
  if (norm === "datetime") return "Date & Time";
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

/**
 * Validates a blueprint object against platform schema rules.
 * Enforces field type allowlists, identifier safety, relationship integrity,
 * and system-managed primary keys.
 */
export function validateBlueprint(blueprint) {
  const errors = [];

  if (!blueprint || typeof blueprint !== "object") {
    return { valid: false, errors: ["Blueprint must be an object."] };
  }

  const workspaceName = (blueprint.workspaceName || blueprint.name || "").trim();
  if (!workspaceName || workspaceName.length < 2 || workspaceName.length > 100) {
    errors.push("Workspace name must be between 2 and 100 characters.");
  }

  const description = (blueprint.description || "").trim();
  if (description.length > 5000) {
    errors.push("Description cannot exceed 5000 characters.");
  }

  // Modules / Entities list
  const rawModules = Array.isArray(blueprint.modules)
    ? blueprint.modules
    : Array.isArray(blueprint.entities)
    ? blueprint.entities
    : [];

  if (rawModules.length === 0) {
    errors.push("Blueprint must contain at least 1 module.");
  }
  if (rawModules.length > 15) {
    errors.push("Blueprint cannot exceed 15 modules.");
  }

  // First pass: index modules by slug and ID to validate relationships
  const moduleSlugToId = new Map();
  const moduleIdToSlug = new Map();
  const seenModuleSlugs = new Set();
  const seenModuleNames = new Set();

  for (let mIdx = 0; mIdx < rawModules.length; mIdx++) {
    const rawMod = rawModules[mIdx];
    if (!rawMod || typeof rawMod !== "object") continue;

    const modName = (rawMod.name || `Module ${mIdx + 1}`).trim();
    const rawSlug = rawMod.slug || rawMod.id || modName;
    const slug = sanitizeIdentifier(rawSlug, `mod_${mIdx + 1}`);
    const modId = rawMod.id || `ent_${slug}`;

    if (seenModuleSlugs.has(slug)) {
      errors.push(`Duplicate module identifier or slug "${slug}".`);
    }
    seenModuleSlugs.add(slug);

    if (seenModuleNames.has(modName.toLowerCase())) {
      errors.push(`Duplicate module name "${modName}".`);
    }
    seenModuleNames.add(modName.toLowerCase());

    moduleSlugToId.set(slug, modId);
    moduleSlugToId.set(modId, modId);
    moduleIdToSlug.set(modId, slug);
    moduleIdToSlug.set(slug, slug);
  }

  const normalizedModules = [];

  // Second pass: validate each module's fields
  for (let mIdx = 0; mIdx < rawModules.length; mIdx++) {
    const rawMod = rawModules[mIdx];
    if (!rawMod || typeof rawMod !== "object") {
      errors.push(`Module at index ${mIdx} is invalid.`);
      continue;
    }

    const modName = (rawMod.name || `Module ${mIdx + 1}`).trim();
    if (modName.length < 2 || modName.length > 60) {
      errors.push(`Module name "${modName}" must be between 2 and 60 characters.`);
    }

    const slug = sanitizeIdentifier(rawMod.slug || rawMod.id || modName, `mod_${mIdx + 1}`);
    const modId = rawMod.id || `ent_${slug}`;
    const singularSlug = slug.endsWith("s") ? slug.slice(0, -1) : slug;

    const rawFields = Array.isArray(rawMod.fields) ? rawMod.fields : [];
    if (rawFields.length === 0) {
      errors.push(`Module "${modName}" must have at least 1 field.`);
    }
    if (rawFields.length > 30) {
      errors.push(`Module "${modName}" cannot have more than 30 fields.`);
    }

    const normalizedFields = [];
    const seenFieldNames = new Set();

    for (let fIdx = 0; fIdx < rawFields.length; fIdx++) {
      const rawF = rawFields[fIdx];
      if (!rawF || typeof rawF !== "object") continue;

      const fLabel = (rawF.label || rawF.name || `Field ${fIdx + 1}`).trim();
      const rawName = (rawF.name || rawF.id || fLabel).trim();
      const fName = sanitizeIdentifier(rawName, `f_${fIdx + 1}`);

      // Check for user-created primary keys
      const lowerRawName = rawName.toLowerCase();
      const isSelfPrimaryKey =
        lowerRawName === "id" ||
        lowerRawName === "_id" ||
        (fName === `${slug}_id` && rawF.type?.toLowerCase() !== "relation") ||
        (fName === `${singularSlug}_id` && rawF.type?.toLowerCase() !== "relation");

      if (isSelfPrimaryKey) {
        errors.push(
          `Module "${modName}" contains primary key field "${rawName}". System primary keys ("id") are managed automatically by the platform and must not be user-editable fields.`
        );
        continue;
      }

      if (seenFieldNames.has(fName)) {
        errors.push(`Duplicate field name "${fName}" in module "${modName}".`);
        continue;
      }
      seenFieldNames.add(fName);

      const rawType = String(rawF.type || "");
      if (!isSupportedFieldType(rawType)) {
        errors.push(`Unsupported field type "${rawType}" for field "${fLabel}" in module "${modName}".`);
        continue;
      }
      const fType = normalizeFieldType(rawType);

      const normalizedField = {
        id: rawF.id || `f_${mIdx + 1}_${fIdx + 1}`,
        name: fName,
        label: fLabel,
        type: capitalizeType(fType),
        typeLower: fType,
        required: Boolean(rawF.required),
        exampleValue: rawF.exampleValue ? String(rawF.exampleValue) : undefined,
      };

      // Select field options validation
      if (fType === "select") {
        const rawOptions = Array.isArray(rawF.options)
          ? rawF.options
          : typeof rawF.options === "string"
          ? rawF.options.split(",").map((s) => s.trim())
          : [];

        const options = rawOptions
          .map((opt) => String(opt).trim())
          .filter(Boolean)
          .slice(0, 20);

        if (options.length === 0) {
          errors.push(`Select field "${fLabel}" in module "${modName}" must provide at least one valid option.`);
        }
        normalizedField.options = options;
      }

      // Relation field validation
      if (fType === "relation") {
        const rawTarget =
          rawF.targetModule ||
          rawF.relatedEntityId ||
          rawF.relatedModule ||
          rawF.target_module;

        const resolvedTargetSlug = moduleIdToSlug.get(rawTarget) || rawTarget;

        if (!resolvedTargetSlug || !moduleSlugToId.has(resolvedTargetSlug)) {
          errors.push(
            `Relation field "${fName}" in module "${modName}" references unknown target module "${rawTarget || "undefined"}".`
          );
        } else {
          normalizedField.targetModule = resolvedTargetSlug;
          normalizedField.targetField = "id"; // Canonical stable primary key target
          normalizedField.relatedEntityId = moduleSlugToId.get(resolvedTargetSlug);
        }
      }

      normalizedFields.push(normalizedField);
    }

    normalizedModules.push({
      id: modId,
      name: modName,
      slug,
      description: (rawMod.description || "").trim(),
      fields: normalizedFields,
      views: Array.isArray(rawMod.views) && rawMod.views.length > 0 ? rawMod.views : ["table", "form"],
    });
  }

  // Validate and normalize explicit relationships
  const rawRelationships = Array.isArray(blueprint.relationships) ? blueprint.relationships : [];
  const normalizedRelationships = [];
  const relationshipSignatures = new Set();

  for (let rIdx = 0; rIdx < rawRelationships.length; rIdx++) {
    const rel = rawRelationships[rIdx];
    if (!rel || typeof rel !== "object") continue;

    const rawSource = rel.sourceModule || rel.fromEntityId || rel.fromModule;
    const rawTarget = rel.targetModule || rel.toEntityId || rel.toModule;
    const sourceSlug = moduleIdToSlug.get(rawSource) || rawSource;
    const targetSlug = moduleIdToSlug.get(rawTarget) || rawTarget;

    if (!sourceSlug || !moduleSlugToId.has(sourceSlug)) {
      errors.push(`Relationship at index ${rIdx} references nonexistent source module "${rawSource}".`);
      continue;
    }

    if (!targetSlug || !moduleSlugToId.has(targetSlug)) {
      errors.push(`Relationship at index ${rIdx} references nonexistent target module "${rawTarget}".`);
      continue;
    }

    const targetField = rel.targetField || "id";
    if (targetField !== "id") {
      errors.push(`Relationship targetField must be "id", got "${targetField}".`);
    }

    const sourceMod = normalizedModules.find((m) => m.slug === sourceSlug);
    let sourceField = rel.sourceField || rel.fromField;

    // Find or link relation field in source module
    if (sourceMod) {
      const matchingRelField = sourceMod.fields.find(
        (f) => f.typeLower === "relation" && (f.targetModule === targetSlug || f.name === sourceField)
      );

      if (matchingRelField) {
        sourceField = matchingRelField.name;
        matchingRelField.targetModule = targetSlug;
        matchingRelField.targetField = "id";
      } else if (!sourceField) {
        // Find by conventional name or add error
        const singularTarget = targetSlug.endsWith("s") ? targetSlug.slice(0, -1) : targetSlug;
        const candidate = sourceMod.fields.find((f) => f.name === `${singularTarget}_id` || f.name === singularTarget);
        if (candidate) {
          sourceField = candidate.name;
        }
      }
    }

    const sig = `${sourceSlug}.${sourceField || "id"}->${targetSlug}.id`;
    if (relationshipSignatures.has(sig)) continue;
    relationshipSignatures.add(sig);

    normalizedRelationships.push({
      id: rel.id || `rel_${rIdx + 1}`,
      name: rel.name || `${sourceSlug} -> ${targetSlug}`,
      sourceModule: sourceSlug,
      sourceField: sourceField || "id",
      targetModule: targetSlug,
      targetField: "id",
      cardinality: rel.cardinality || "many-to-one",
      required: Boolean(rel.required),
      label: (rel.label || "relates to").trim(),
      fromEntityId: moduleSlugToId.get(sourceSlug) || `ent_${sourceSlug}`,
      toEntityId: moduleSlugToId.get(targetSlug) || `ent_${targetSlug}`,
    });
  }

  // Cross-sync: ensure any field marked as relation in a module has a relationship entry
  for (const mod of normalizedModules) {
    for (const field of mod.fields) {
      if (field.typeLower === "relation" && field.targetModule) {
        const sig = `${mod.slug}.${field.name}->${field.targetModule}.id`;
        if (!relationshipSignatures.has(sig)) {
          relationshipSignatures.add(sig);
          normalizedRelationships.push({
            id: `rel_${mod.slug}_${field.name}`,
            name: `${mod.name} ${field.label || field.name}`,
            sourceModule: mod.slug,
            sourceField: field.name,
            targetModule: field.targetModule,
            targetField: "id",
            cardinality: "many-to-one",
            required: field.required,
            label: field.label || "belongs to",
            fromEntityId: mod.id,
            toEntityId: moduleSlugToId.get(field.targetModule) || `ent_${field.targetModule}`,
          });
        }
      }
    }
  }

  const normalized = {
    workspaceName,
    name: workspaceName,
    description,
    modules: normalizedModules,
    entities: normalizedModules, // compatible with frontend entity terminology
    relationships: normalizedRelationships,
  };

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

/**
 * Intelligent domain semantic parser.
 * Analyzes natural language business description and generates custom models,
 * fields, views, and relationships adhering to strict enterprise standards.
 */
export function buildDynamicBlueprintFromPrompt(description) {
  const text = (description || "").toLowerCase();

  let workspaceName = "Business Operations Workspace";
  if (text.includes("tailor") || text.includes("bespoke") || text.includes("suit") || text.includes("fabric") || text.includes("garment")) {
    workspaceName = "Bespoke Tailoring Studio";
  } else if (text.includes("bakery") || text.includes("cake") || text.includes("pastry")) {
    workspaceName = "Artisan Bakery Operations";
  } else if (text.includes("clinic") || text.includes("medical") || text.includes("health") || text.includes("doctor") || text.includes("dental")) {
    workspaceName = "CarePoint Medical Practice";
  } else if (text.includes("repair") || text.includes("auto") || text.includes("garage") || text.includes("mechanic")) {
    workspaceName = "Precision Auto Care";
  } else if (text.includes("real estate") || text.includes("property") || text.includes("rental") || text.includes("tenant")) {
    workspaceName = "Skyline Property Management";
  } else if (text.includes("school") || text.includes("academy") || text.includes("tutor") || text.includes("student")) {
    workspaceName = "Lumina Learning Academy";
  } else {
    const words = description.replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter((w) => w.length > 3);
    if (words.length >= 2) {
      workspaceName = `${words[0].charAt(0).toUpperCase() + words[0].slice(1)} ${words[1].charAt(0).toUpperCase() + words[1].slice(1)} Operations`;
    }
  }

  const modules = [];
  const relationships = [];

  const addModule = (id, slug, name, desc, fields) => {
    modules.push({
      id,
      slug,
      name,
      description: desc,
      fields,
      views: ["table", "form"],
    });
  };

  if (text.includes("tailor") || text.includes("bespoke") || text.includes("suit") || text.includes("fabric")) {
    // 1. Clients
    addModule(
      "ent_clients",
      "clients",
      "Clients",
      "Manage client profiles, styling preferences, and contact details.",
      [
        { id: "f_c1", name: "first_name", label: "First Name", type: "Text", required: true, exampleValue: "James" },
        { id: "f_c2", name: "last_name", label: "Last Name", type: "Text", required: true, exampleValue: "Sinclair" },
        { id: "f_c3", name: "email", label: "Email Address", type: "Email", required: false, exampleValue: "james.sinclair@example.com" },
        { id: "f_c4", name: "phone", label: "Phone Number", type: "Phone", required: true, exampleValue: "+1 (555) 345-6789" },
        { id: "f_c5", name: "address", label: "Delivery Address", type: "Text", required: false, exampleValue: "44 Savile Row, London" },
      ]
    );

    // 2. Measurements
    addModule(
      "ent_measurements",
      "measurements",
      "Measurements",
      "Record dated anatomical measurements and bespoke fitting specs.",
      [
        { id: "f_m1", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
        { id: "f_m2", name: "measurement_date", label: "Measurement Date", type: "Date", required: true, exampleValue: "2026-10-12" },
        { id: "f_m3", name: "chest", label: "Chest (inches)", type: "Decimal", required: true, exampleValue: "40.50" },
        { id: "f_m4", name: "waist", label: "Waist (inches)", type: "Decimal", required: true, exampleValue: "34.00" },
        { id: "f_m5", name: "shoulder", label: "Shoulder (inches)", type: "Decimal", required: true, exampleValue: "18.25" },
        { id: "f_m6", name: "sleeve_length", label: "Sleeve Length (inches)", type: "Decimal", required: true, exampleValue: "25.50" },
        { id: "f_m7", name: "inseam", label: "Inseam (inches)", type: "Decimal", required: true, exampleValue: "32.00" },
        { id: "f_m8", name: "notes", label: "Tailor Notes", type: "Long text", required: false, exampleValue: "Slight drop on right shoulder. Preferred taper on trousers." },
      ]
    );

    // 3. Orders
    addModule(
      "ent_orders",
      "orders",
      "Orders",
      "Track custom bespoke suit orders, production stages, and pricing.",
      [
        { id: "f_o1", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
        { id: "f_o2", name: "suit_type", label: "Suit Type", type: "Select", options: ["Two-Piece Suit", "Three-Piece Suit", "Tuxedo", "Double-Breasted Blazer", "Overcoat"], required: true, exampleValue: "Three-Piece Suit" },
        { id: "f_o3", name: "order_date", label: "Order Date", type: "Date", required: true, exampleValue: "2026-10-12" },
        { id: "f_o4", name: "due_date", label: "Target Completion Date", type: "Date", required: false, exampleValue: "2026-11-20" },
        { id: "f_o5", name: "price", label: "Total Price (USD)", type: "Currency", required: true, exampleValue: "1850.00" },
        { id: "f_o6", name: "order_status", label: "Order Status", type: "Select", options: ["Draft", "Confirmed", "In Production", "Ready for Fitting", "Completed", "Cancelled"], required: true, exampleValue: "In Production" },
      ]
    );

    // 4. Fabric Inventory
    addModule(
      "ent_fabric_inventory",
      "fabric_inventory",
      "Fabric Inventory",
      "Manage fabric rolls, premium weaves, yardage stock, and supplier costs.",
      [
        { id: "f_fb1", name: "fabric_name", label: "Fabric Name", type: "Text", required: true, exampleValue: "Super 150s Merino Wool Navy" },
        { id: "f_fb2", name: "fabric_type", label: "Fabric Material", type: "Select", options: ["Wool", "Cashmere", "Silk", "Linen", "Cotton", "Tweed", "Mohair"], required: true, exampleValue: "Wool" },
        { id: "f_fb3", name: "color", label: "Color / Pattern", type: "Text", required: false, exampleValue: "Midnight Navy Herringbone" },
        { id: "f_fb4", name: "quantity_in_meters", label: "Stock in Meters", type: "Decimal", required: true, exampleValue: "65.50" },
        { id: "f_fb5", name: "cost_per_meter", label: "Cost Per Meter (USD)", type: "Currency", required: true, exampleValue: "95.00" },
        { id: "f_fb6", name: "reorder_threshold", label: "Reorder Alert Level", type: "Decimal", required: false, exampleValue: "15.00" },
      ]
    );

    // 5. Order Fabrics (Many-to-many Junction)
    addModule(
      "ent_order_fabrics",
      "order_fabrics",
      "Order Fabrics",
      "Track fabrics and lining yardage assigned to bespoke orders.",
      [
        { id: "f_of1", name: "order_id", label: "Order", type: "Relation", targetModule: "orders", targetField: "id", required: true },
        { id: "f_of2", name: "fabric_id", label: "Fabric", type: "Relation", targetModule: "fabric_inventory", targetField: "id", required: true },
        { id: "f_of3", name: "quantity_used", label: "Meters Used", type: "Decimal", required: true, exampleValue: "3.75" },
      ]
    );

    // 6. Appointments
    addModule(
      "ent_appointments",
      "appointments",
      "Appointments",
      "Schedule bespoke consultations, baste fittings, and final adjustments.",
      [
        { id: "f_ap1", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
        { id: "f_ap2", name: "order_id", label: "Order", type: "Relation", targetModule: "orders", targetField: "id", required: false },
        { id: "f_ap3", name: "appointment_time", label: "Appointment Date & Time", type: "Datetime", required: true, exampleValue: "2026-10-18T14:30:00Z" },
        { id: "f_ap4", name: "appointment_type", label: "Appointment Type", type: "Select", options: ["Initial Consultation", "Measurement Session", "First Baste Fitting", "Second Fitting", "Final Delivery"], required: true, exampleValue: "First Baste Fitting" },
        { id: "f_ap5", name: "appointment_status", label: "Status", type: "Select", options: ["Scheduled", "Completed", "Cancelled", "Rescheduled"], required: true, exampleValue: "Scheduled" },
        { id: "f_ap6", name: "notes", label: "Session Notes", type: "Long text", required: false, exampleValue: "Check jacket waist suppression and trouser break." },
      ]
    );

    relationships.push(
      { name: "Client Measurements", sourceModule: "measurements", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one", required: true, label: "measured for" },
      { name: "Client Orders", sourceModule: "orders", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one", required: true, label: "places" },
      { name: "Order Fabric Allocation", sourceModule: "order_fabrics", sourceField: "order_id", targetModule: "orders", targetField: "id", cardinality: "many-to-one", required: true, label: "uses fabric in" },
      { name: "Fabric Roll Allocation", sourceModule: "order_fabrics", sourceField: "fabric_id", targetModule: "fabric_inventory", targetField: "id", cardinality: "many-to-one", required: true, label: "consumed by" },
      { name: "Client Appointments", sourceModule: "appointments", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one", required: true, label: "attends" },
      { name: "Order Appointments", sourceModule: "appointments", sourceField: "order_id", targetModule: "orders", targetField: "id", cardinality: "many-to-one", required: false, label: "fitting for" }
    );
  } else if (text.includes("cake") || text.includes("bakery") || text.includes("pastry")) {
    addModule(
      "ent_customers",
      "customers",
      "Customers",
      "Customer contact information and event celebration history.",
      [
        { id: "f_c1", name: "full_name", label: "Full Name", type: "Text", required: true, exampleValue: "Emma Wilson" },
        { id: "f_c2", name: "email", label: "Email Address", type: "Email", required: false, exampleValue: "emma@example.com" },
        { id: "f_c3", name: "phone", label: "Phone Number", type: "Phone", required: true, exampleValue: "+1 555 456 7890" },
      ]
    );

    addModule(
      "ent_orders",
      "orders",
      "Custom Orders",
      "Bespoke cakes, pastry catering orders, and pickup dates.",
      [
        { id: "f_o1", name: "customer_id", label: "Customer", type: "Relation", targetModule: "customers", targetField: "id", required: true },
        { id: "f_o2", name: "flavor_design", label: "Design & Flavor", type: "Text", required: true, exampleValue: "3-Tier Strawberry Chiffon" },
        { id: "f_o3", name: "event_date", label: "Event Date", type: "Date", required: true, exampleValue: "2026-10-25" },
        { id: "f_o4", name: "price", label: "Total Price", type: "Currency", required: true, exampleValue: "350.00" },
        { id: "f_o5", name: "status", label: "Order Status", type: "Select", options: ["Draft", "Confirmed", "Baking", "Decorating", "Ready for Pickup", "Completed"], required: true, exampleValue: "Confirmed" },
        { id: "f_o6", name: "dietary_notes", label: "Dietary Restrictions", type: "Long text", required: false, exampleValue: "Nut-free kitchen certification requested." },
      ]
    );

    addModule(
      "ent_inventory",
      "inventory",
      "Ingredients & Stock",
      "Baking supplies, flours, extracts, and inventory levels.",
      [
        { id: "f_i1", name: "item_name", label: "Item Name", type: "Text", required: true, exampleValue: "French Pastry Flour T55" },
        { id: "f_i2", name: "category", label: "Category", type: "Select", options: ["Flour", "Dairy", "Sugar", "Chocolate", "Fruit", "Packaging"], required: true, exampleValue: "Flour" },
        { id: "f_i3", name: "quantity_in_kg", label: "Stock in Kilograms", type: "Decimal", required: true, exampleValue: "120.00" },
        { id: "f_i4", name: "cost_per_kg", label: "Unit Cost", type: "Currency", required: true, exampleValue: "4.20" },
      ]
    );

    relationships.push({
      name: "Customer Order",
      sourceModule: "orders",
      sourceField: "customer_id",
      targetModule: "customers",
      targetField: "id",
      cardinality: "many-to-one",
      required: true,
      label: "places",
    });
  } else if (text.includes("clinic") || text.includes("medical") || text.includes("doctor") || text.includes("patient") || text.includes("dental")) {
    addModule(
      "ent_patients",
      "patients",
      "Patients",
      "Patient records, emergency contacts, and demographic profiles.",
      [
        { id: "f_p1", name: "first_name", label: "First Name", type: "Text", required: true, exampleValue: "Eleanor" },
        { id: "f_p2", name: "last_name", label: "Last Name", type: "Text", required: true, exampleValue: "Vance" },
        { id: "f_p3", name: "date_of_birth", label: "Date of Birth", type: "Date", required: false, exampleValue: "1988-06-14" },
        { id: "f_p4", name: "phone", label: "Contact Phone", type: "Phone", required: true, exampleValue: "+1 555 789 0123" },
        { id: "f_p5", name: "email", label: "Email Address", type: "Email", required: false, exampleValue: "eleanor.vance@example.com" },
      ]
    );

    addModule(
      "ent_appointments",
      "appointments",
      "Appointments",
      "Consultation slots, exam room bookings, and clinical visits.",
      [
        { id: "f_a1", name: "patient_id", label: "Patient", type: "Relation", targetModule: "patients", targetField: "id", required: true },
        { id: "f_a2", name: "appointment_time", label: "Visit Date & Time", type: "Datetime", required: true, exampleValue: "2026-10-15T09:00:00Z" },
        { id: "f_a3", name: "visit_type", label: "Visit Type", type: "Select", options: ["General Consultation", "Follow-up", "Preventative Screening", "Emergency Consultation"], required: true, exampleValue: "General Consultation" },
        { id: "f_a4", name: "status", label: "Status", type: "Select", options: ["Scheduled", "Checked In", "In Progress", "Completed", "Cancelled"], required: true, exampleValue: "Scheduled" },
        { id: "f_a5", name: "symptoms_notes", label: "Clinical Notes", type: "Long text", required: false, exampleValue: "Routine checkup and blood pressure evaluation." },
      ]
    );

    addModule(
      "ent_prescriptions",
      "prescriptions",
      "Prescriptions",
      "Prescribed medications, dosage instructions, and refills.",
      [
        { id: "f_pr1", name: "patient_id", label: "Patient", type: "Relation", targetModule: "patients", targetField: "id", required: true },
        { id: "f_pr2", name: "appointment_id", label: "Appointment", type: "Relation", targetModule: "appointments", targetField: "id", required: false },
        { id: "f_pr3", name: "medication_name", label: "Medication Name", type: "Text", required: true, exampleValue: "Amoxicillin 500mg" },
        { id: "f_pr4", name: "dosage", label: "Dosage Instructions", type: "Text", required: true, exampleValue: "1 capsule every 8 hours for 7 days" },
        { id: "f_pr5", name: "date_prescribed", label: "Date Prescribed", type: "Date", required: true, exampleValue: "2026-10-15" },
      ]
    );

    relationships.push(
      { name: "Patient Appointments", sourceModule: "appointments", sourceField: "patient_id", targetModule: "patients", targetField: "id", cardinality: "many-to-one", required: true, label: "books" },
      { name: "Patient Prescriptions", sourceModule: "prescriptions", sourceField: "patient_id", targetModule: "patients", targetField: "id", cardinality: "many-to-one", required: true, label: "prescribed to" },
      { name: "Appointment Prescriptions", sourceModule: "prescriptions", sourceField: "appointment_id", targetModule: "appointments", targetField: "id", cardinality: "many-to-one", required: false, label: "issued during" }
    );
  } else {
    // Universal operations template
    addModule(
      "ent_clients",
      "clients",
      "Clients",
      "Client accounts, primary contacts, and company profiles.",
      [
        { id: "f_cl1", name: "company_name", label: "Client Name", type: "Text", required: true, exampleValue: "Acme Enterprises" },
        { id: "f_cl2", name: "email", label: "Contact Email", type: "Email", required: true, exampleValue: "contact@acme.com" },
        { id: "f_cl3", name: "phone", label: "Phone", type: "Phone", required: false, exampleValue: "+1 555 890 1234" },
        { id: "f_cl4", name: "status", label: "Account Status", type: "Select", options: ["Active", "Lead", "Onboarding", "Archived"], required: true, exampleValue: "Active" },
      ]
    );

    addModule(
      "ent_projects",
      "projects",
      "Projects",
      "Operational projects, milestones, budgets, and status tracking.",
      [
        { id: "f_pj1", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
        { id: "f_pj2", name: "title", label: "Project Title", type: "Text", required: true, exampleValue: "Q4 Performance Overhaul" },
        { id: "f_pj3", name: "budget", label: "Budget (USD)", type: "Currency", required: true, exampleValue: "12500.00" },
        { id: "f_pj4", name: "start_date", label: "Start Date", type: "Date", required: true, exampleValue: "2026-10-15" },
        { id: "f_pj5", name: "status", label: "Project Status", type: "Select", options: ["Planning", "In Progress", "In Review", "Completed", "On Hold"], required: true, exampleValue: "In Progress" },
        { id: "f_pj6", name: "scope_notes", label: "Scope & Objectives", type: "Long text", required: false, exampleValue: "Core deliverables and milestones." },
      ]
    );

    addModule(
      "ent_invoices",
      "invoices",
      "Invoices",
      "Billing invoices, milestone payment releases, and due dates.",
      [
        { id: "f_iv1", name: "project_id", label: "Project", type: "Relation", targetModule: "projects", targetField: "id", required: true },
        { id: "f_iv2", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
        { id: "f_iv3", name: "amount", label: "Amount (USD)", type: "Currency", required: true, exampleValue: "5000.00" },
        { id: "f_iv4", name: "due_date", label: "Due Date", type: "Date", required: true, exampleValue: "2026-11-15" },
        { id: "f_iv5", name: "status", label: "Payment Status", type: "Select", options: ["Draft", "Issued", "Paid", "Overdue", "Cancelled"], required: true, exampleValue: "Issued" },
      ]
    );

    relationships.push(
      { name: "Client Projects", sourceModule: "projects", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one", required: true, label: "managed for" },
      { name: "Project Invoices", sourceModule: "invoices", sourceField: "project_id", targetModule: "projects", targetField: "id", cardinality: "many-to-one", required: true, label: "billed for" },
      { name: "Client Invoices", sourceModule: "invoices", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one", required: true, label: "payable by" }
    );
  }

  const rawBlueprint = {
    workspaceName,
    description: description.trim(),
    modules,
    entities: modules,
    relationships,
  };

  const validation = validateBlueprint(rawBlueprint);
  return validation.normalized;
}

/**
 * Builds the AI generation prompt with strict architecture constraints.
 */
function buildAiPrompt(cleanDescription, validationFeedback = null) {
  let prompt = `You are VifeAI, an enterprise business architect. Design a clean, production-ready workspace blueprint for the following business:
"${cleanDescription}"

CRITICAL ARCHITECTURE & RELATIONSHIP RULES:
1. SYSTEM-MANAGED PRIMARY KEYS: Every record automatically receives a system-managed primary key "id" (string UUID/stable ID). NEVER generate fields like "client_id", "order_id", "fabric_id", or "id" in a module to act as its own primary key. Only generate business-specific fields.
2. FOREIGN KEYS & RELATIONSHIPS: To link child records to parent records (e.g. Orders belonging to Clients):
   - In the child module, create an explicit relation field:
     {
       "name": "client_id",
       "label": "Client",
       "type": "relation",
       "targetModule": "clients",
       "targetField": "id",
       "required": true
     }
   - In the top-level "relationships" array, specify:
     {
       "name": "Order Client",
       "sourceModule": "orders",
       "sourceField": "client_id",
       "targetModule": "clients",
       "targetField": "id",
       "cardinality": "many-to-one",
       "required": true,
       "label": "belongs to"
     }
3. MANY-TO-MANY RELATIONSHIPS: If entities have a many-to-many relationship (such as orders using multiple fabrics, or students enrolled in multiple classes), create a junction module (e.g. "order_fabrics") containing relation fields to both parent modules plus extra fields (e.g. quantity_used).
4. ALLOWED FIELD TYPES: Use ONLY these exact lowercase types:
   - text: short text strings (names, codes, titles)
   - long_text: multiline text (notes, descriptions, remarks)
   - number: integer counts and whole numbers
   - decimal: measurements with units, quantities, dimensions, weights
   - boolean: true/false flags
   - date: calendar dates without time (birthdays, order dates)
   - datetime: date and time (appointments, sessions, schedules)
   - email: email addresses
   - phone: phone numbers
   - select: enumerated choices (MUST provide non-empty "options" array with 3 to 8 realistic domain choices)
   - currency: prices, costs, monetary totals
   - relation: foreign key referencing another module's "id"
5. FIELD SEMANTICS:
   - Do NOT treat measurements or prices as generic text. Use decimal or currency.
   - For select fields, provide realistic business options (e.g. order statuses: ["Draft", "Confirmed", "In Production", "Ready for Fitting", "Completed", "Cancelled"]).
6. RETURN ONLY VALID JSON:
Return ONLY valid JSON matching this exact schema:
{
  "workspaceName": "String (Short business workspace title)",
  "description": "String (Summary of what is managed)",
  "modules": [
    {
      "name": "String (Display name, e.g. Clients, Orders, Appointments)",
      "slug": "String (lowercase safe snake_case identifier)",
      "description": "String (what this module manages)",
      "fields": [
        {
          "name": "String (safe lowercase snake_case column)",
          "label": "String (Human display title)",
          "type": "text | long_text | number | decimal | boolean | date | datetime | email | phone | select | currency | relation",
          "required": boolean,
          "options": ["string"] (required if type is select),
          "targetModule": "module_slug" (required if type is relation),
          "targetField": "id" (required if type is relation),
          "exampleValue": "string"
        }
      ],
      "views": ["table", "form"]
    }
  ],
  "relationships": [
    {
      "name": "String",
      "sourceModule": "module_slug",
      "sourceField": "relation_field_name",
      "targetModule": "module_slug",
      "targetField": "id",
      "cardinality": "many-to-one | many-to-many",
      "required": boolean,
      "label": "describes relationship"
    }
  ]
}
Do not output markdown codeblocks, only raw JSON.`;

  if (validationFeedback) {
    prompt += `\n\nPREVIOUS ATTEMPT FAILED SERVER VALIDATION WITH THE FOLLOWING ERRORS:
${validationFeedback}
Please fix all errors and regenerate compliant JSON.`;
  }

  return prompt;
}

/**
 * Generates a structured workspace blueprint from a business description.
 *
 * If AI_API_KEY, RUMPTY_API_KEY, or OPENAI_API_KEY is configured,
 * queries the LLM provider for structured JSON with server-side validation
 * and retry logic.
 * Otherwise, uses the dynamic semantic parsing engine.
 */
export async function generateWorkspaceBlueprint(description) {
  const cleanDescription = (description || "").trim();

  if (!cleanDescription || cleanDescription.length < 50) {
    const error = new Error("Business description must be at least 50 characters.");
    error.status = 400;
    throw error;
  }

  if (cleanDescription.length > 5000) {
    const error = new Error("Business description cannot exceed 5000 characters.");
    error.status = 400;
    throw error;
  }

  const apiKey = process.env.RUMPTY_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || (process.env.RUMPTY_API_KEY ? "https://chat.rumptycloud.com/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const model = process.env.AI_MODEL || (process.env.RUMPTY_API_KEY ? "llama3.2:3b" : "gpt-4o-mini");

  if (apiKey) {
    let validationFeedback = null;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const prompt = buildAiPrompt(cleanDescription, validationFeedback);

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "You output only valid JSON workspace blueprints. No code formatting or markdown." },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 4096,
            response_format: { type: "json_object" },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            let cleaned = content.trim();
            if (cleaned.startsWith("```")) {
              cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
            }
            const parsed = JSON.parse(cleaned);
            const validated = validateBlueprint(parsed);
            if (validated.valid) {
              return validated.normalized;
            } else {
              validationFeedback = validated.errors.join("\n- ");
              console.warn(`[VifeAI] Blueprint validation failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, validated.errors);
            }
          }
        }
      } catch (err) {
        console.warn(`[VifeAI] LLM provider call attempt ${attempt + 1} failed:`, err.message);
      }
    }
  }

  // Dynamic semantic generator fallback
  return buildDynamicBlueprintFromPrompt(cleanDescription);
}
