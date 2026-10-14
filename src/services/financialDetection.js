// ============================================================
// VifeMS — Dynamic Financial Feature Detection Engine
// src/services/financialDetection.js
//
// Analyzes workspace blueprints and dynamically provisioned modules
// to determine whether financial capabilities (invoicing, receipts,
// payment tracking) are relevant and identify source records and payers.
// ============================================================

const FINANCIAL_MODULE_KEYWORDS = [
  "order",
  "orders",
  "sale",
  "sales",
  "invoice",
  "invoices",
  "billing",
  "payment",
  "payments",
  "transaction",
  "transactions",
  "booking",
  "bookings",
  "repair",
  "repairs",
  "service",
  "services",
  "tuition",
  "fee",
  "fees",
  "subscription",
  "subscriptions",
  "charge",
  "charges",
  "contract",
  "contracts",
  "appointment",
  "appointments",
  "project",
  "projects",
];

const FINANCIAL_FIELD_KEYWORDS = [
  "price",
  "amount",
  "cost",
  "fee",
  "total",
  "subtotal",
  "balance",
  "rate",
  "charge",
  "deposit",
  "tuition",
  "budget",
  "salary",
  "fare",
  "rent",
  "bill",
];

const PAYER_MODULE_KEYWORDS = [
  "customer",
  "customers",
  "client",
  "clients",
  "patient",
  "patients",
  "student",
  "students",
  "member",
  "members",
  "tenant",
  "tenants",
  "guest",
  "guests",
  "buyer",
  "buyers",
  "payer",
  "payers",
  "owner",
  "owners",
  "contact",
  "contacts",
  "account",
  "accounts",
];

/**
 * Normalizes an array of modules from either a workspace object or blueprint.
 */
function extractModules(workspaceOrBlueprint) {
  if (!workspaceOrBlueprint) return [];
  if (Array.isArray(workspaceOrBlueprint.modules)) {
    return workspaceOrBlueprint.modules;
  }
  if (Array.isArray(workspaceOrBlueprint.entities)) {
    return workspaceOrBlueprint.entities;
  }
  return [];
}

/**
 * Detects whether a workspace requires invoicing and receipt capabilities
 * and maps its chargeable records, payers, and existing modules.
 */
export function detectFinancialCapabilities(workspaceOrBlueprint) {
  const modules = extractModules(workspaceOrBlueprint);
  if (!modules || modules.length === 0) {
    return {
      enabled: false,
      reason: "No business modules found in workspace.",
      chargeableModules: [],
      payerModules: [],
      existingInvoiceModule: null,
      existingPaymentModule: null,
      defaultCurrency: "USD",
    };
  }

  const chargeableModules = [];
  const payerModules = [];
  let existingInvoiceModule = null;
  let existingPaymentModule = null;
  let detectedCurrency = "USD";
  let hasFinancialField = false;

  for (const mod of modules) {
    const slug = (mod.slug || mod.id || mod.name || "").toLowerCase();
    const name = (mod.name || "").toLowerCase();
    const fields = Array.isArray(mod.fields) ? mod.fields : [];

    // Check if this module already acts as a payment or invoice module
    if (slug === "invoices" || slug === "invoice" || name.includes("invoice") || name.includes("billing")) {
      existingInvoiceModule = {
        id: mod.id,
        slug: mod.slug || slug,
        name: mod.name,
      };
    }

    if (slug === "payments" || slug === "payment" || name.includes("payment") || name.includes("transaction")) {
      existingPaymentModule = {
        id: mod.id,
        slug: mod.slug || slug,
        name: mod.name,
      };
    }

    // Check for payer modules (Customer, Client, Patient, etc.)
    const isPayer = PAYER_MODULE_KEYWORDS.some((kw) => slug.includes(kw) || name.includes(kw));
    if (isPayer) {
      payerModules.push({
        id: mod.id,
        slug: mod.slug || slug,
        name: mod.name,
        nameField: fields.find((f) => ["name", "full_name", "company_name", "title", "label"].includes(f.name))?.name || "full_name",
        emailField: fields.find((f) => (f.typeLower || f.type || "").toLowerCase() === "email" || f.name.includes("email"))?.name || null,
        phoneField: fields.find((f) => (f.typeLower || f.type || "").toLowerCase() === "phone" || f.name.includes("phone"))?.name || null,
      });
    }

    // Inspect fields for currency or monetary definitions
    let amountField = null;
    let labelField = null;
    let payerRelationField = null;

    for (const f of fields) {
      const fName = (f.name || "").toLowerCase();
      const fType = (f.typeLower || f.type || "").toLowerCase();
      const fLabel = (f.label || "").toLowerCase();

      // Currency detection
      if (fType === "currency" || fLabel.includes("(usd)") || fLabel.includes("($)") || fLabel.includes("dollars")) {
        hasFinancialField = true;
        detectedCurrency = "USD";
      } else if (fLabel.includes("(ngn)") || fLabel.includes("(₦)") || fLabel.includes("naira")) {
        hasFinancialField = true;
        detectedCurrency = "NGN";
      } else if (fLabel.includes("(eur)") || fLabel.includes("(€)") || fLabel.includes("euros")) {
        hasFinancialField = true;
        detectedCurrency = "EUR";
      } else if (fLabel.includes("(gbp)") || fLabel.includes("(£)") || fLabel.includes("pounds")) {
        hasFinancialField = true;
        detectedCurrency = "GBP";
      }

      if (fType === "currency") {
        hasFinancialField = true;
        if (!amountField) amountField = f.name;
      }

      const isMonetaryName = FINANCIAL_FIELD_KEYWORDS.some((kw) => fName.includes(kw) || fLabel.includes(kw));
      if (isMonetaryName && (fType === "currency" || fType === "decimal" || fType === "number")) {
        hasFinancialField = true;
        if (!amountField) amountField = f.name;
      }

      if (["title", "name", "full_name", "label", "item_name", "suit_type", "cake_flavor", "service_name", "job_title"].includes(fName)) {
        if (!labelField) labelField = f.name;
      }

      if (fType === "relation") {
        const target = (f.targetModule || f.relatedEntityId || "").toLowerCase();
        if (PAYER_MODULE_KEYWORDS.some((kw) => target.includes(kw) || fName.includes(kw))) {
          payerRelationField = {
            fieldName: f.name,
            targetModule: f.targetModule || f.relatedEntityId,
          };
        }
      }
    }

    // Check if module is chargeable
    const isModuleKeywordMatch = FINANCIAL_MODULE_KEYWORDS.some((kw) => slug.includes(kw) || name.includes(kw));
    if (amountField || (isModuleKeywordMatch && fields.length > 0)) {
      chargeableModules.push({
        id: mod.id,
        slug: mod.slug || slug,
        name: mod.name,
        amountField: amountField || fields.find((f) => ["number", "decimal", "currency"].includes((f.typeLower || f.type || "").toLowerCase()))?.name || null,
        labelField: labelField || fields[0]?.name || "id",
        payerRelation: payerRelationField,
      });
    }
  }

  const enabled = hasFinancialField || chargeableModules.length > 0 || existingInvoiceModule !== null || existingPaymentModule !== null;

  return {
    enabled,
    reason: enabled
      ? "Financial operations detected from workspace schema."
      : "No financial or billing operations found in workspace schema.",
    chargeableModules,
    payerModules,
    existingInvoiceModule,
    existingPaymentModule,
    defaultCurrency: detectedCurrency,
  };
}
