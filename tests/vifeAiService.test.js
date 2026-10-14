import test from "node:test";
import assert from "node:assert/strict";
import {
  generateWorkspaceBlueprint,
  validateBlueprint,
  sanitizeIdentifier,
  normalizeFieldType,
} from "../src/services/vifeAiService.js";

test("VifeAI Service Unit Tests", async (t) => {
  await t.test("rejects description shorter than 50 characters", async () => {
    await assert.rejects(
      async () => {
        await generateWorkspaceBlueprint("Too short");
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /at least 50 characters/i);
        return true;
      }
    );
  });

  await t.test("rejects description exceeding 5,000 characters", async () => {
    const longDesc = "a".repeat(5001);
    await assert.rejects(
      async () => {
        await generateWorkspaceBlueprint(longDesc);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /cannot exceed 5000 characters/i);
        return true;
      }
    );
  });

  await t.test("sanitizes unsafe identifiers and SQL keywords", () => {
    assert.equal(sanitizeIdentifier("Order"), "biz_order");
    assert.equal(sanitizeIdentifier("Select"), "biz_select");
    assert.equal(sanitizeIdentifier("User"), "biz_user");
    assert.equal(sanitizeIdentifier("123-bad-name"), "mod_123_bad_name");
    assert.equal(sanitizeIdentifier("Customer Invoices & Billing!"), "customer_invoices_billing");
  });

  await t.test("normalizes field types according to controlled allowlist", () => {
    assert.equal(normalizeFieldType("Text"), "text");
    assert.equal(normalizeFieldType("Number"), "number");
    assert.equal(normalizeFieldType("Currency"), "currency");
    assert.equal(normalizeFieldType("Date"), "date");
    assert.equal(normalizeFieldType("Boolean"), "boolean");
    assert.equal(normalizeFieldType("Select"), "select");
    assert.equal(normalizeFieldType("Relation"), "relation");
    assert.equal(normalizeFieldType("UnknownType"), "text");
  });

  await t.test("generates structured, valid blueprint for cake bakery description", async () => {
    const desc = "I run a custom cake bakery and need to track customer orders, cake flavors, ingredients in stock, delivery dates, and payments.";
    const bp = await generateWorkspaceBlueprint(desc);

    assert.ok(bp.workspaceName);
    assert.ok(bp.modules.length >= 2);
    assert.ok(bp.entities.length >= 2);

    const validation = validateBlueprint(bp);
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);

    // Verify fields
    for (const mod of bp.modules) {
      assert.ok(mod.slug);
      assert.ok(mod.fields.length >= 1);
      for (const f of mod.fields) {
        assert.ok(f.name);
        assert.ok(f.type);
      }
    }
  });

  await t.test("rejects malformed blueprint schema with zero modules", () => {
    const malformed = {
      workspaceName: "Empty Workspace",
      modules: [],
    };
    const res = validateBlueprint(malformed);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => /at least 1 module/i.test(e)));
  });

  await t.test("rejects module with zero fields", () => {
    const malformed = {
      workspaceName: "Test Workspace",
      modules: [
        {
          name: "Invalid Module",
          slug: "invalid_module",
          fields: [],
        },
      ],
    };
    const res = validateBlueprint(malformed);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => /at least 1 field/i.test(e)));
  });
});
