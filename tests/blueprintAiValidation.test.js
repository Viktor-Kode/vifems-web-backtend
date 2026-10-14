import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/database.js";
import {
  validateBlueprint,
  buildDynamicBlueprintFromPrompt,
  generateWorkspaceBlueprint,
  normalizeFieldType,
} from "../src/services/vifeAiService.js";
import {
  createWorkspaceGeneration,
  provisionWorkspace,
  getWorkspaceById,
  createRecord,
  listRecords,
  deleteRecord,
} from "../src/services/workspaceService.js";

test("VifeAI Blueprint Generation, Validation, Relationships & Provisioning Suite", async (t) => {
  let user1, user2;
  const createdWorkspaceIds = [];

  t.before(async () => {
    user1 = await prisma.user.create({
      data: {
        fullName: "Tailoring Owner",
        email: `tailor_${Date.now()}@example.com`,
      },
    });

    user2 = await prisma.user.create({
      data: {
        fullName: "Bakery Owner",
        email: `bakery_${Date.now()}@example.com`,
      },
    });
  });

  t.after(async () => {
    for (const wsId of createdWorkspaceIds) {
      const ws = await prisma.workspace.findUnique({
        where: { id: wsId },
        include: { modules: true },
      });
      if (ws) {
        for (const mod of ws.modules) {
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${mod.tableName}" CASCADE;`).catch(() => {});
        }
        await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {});
      }
    }

    if (user1) await prisma.user.delete({ where: { id: user1.id } }).catch(() => {});
    if (user2) await prisma.user.delete({ where: { id: user2.id } }).catch(() => {});
  });

  // Test 1: AI output does not create editable primary-key fields
  await t.test("1. AI output does not create editable primary-key fields", () => {
    const prompt = "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments.";
    const bp = buildDynamicBlueprintFromPrompt(prompt);

    for (const mod of bp.modules) {
      for (const field of mod.fields) {
        // Field must not be named 'id' or mimic the module's PK unless it's a relation
        assert.notEqual(field.name, "id");
        if (field.name.endsWith("_id")) {
          assert.equal(field.typeLower, "relation", `Field ${field.name} in ${mod.slug} must be a relation, not a regular ID field`);
        }
      }
    }
  });

  // Test 2: Orders correctly reference clients through stable IDs
  await t.test("2. Orders correctly reference clients through stable IDs", () => {
    const prompt = "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments.";
    const bp = buildDynamicBlueprintFromPrompt(prompt);

    const ordersMod = bp.modules.find((m) => m.slug === "orders");
    assert.ok(ordersMod, "Orders module must exist");

    const clientRefField = ordersMod.fields.find((f) => f.name === "client_id");
    assert.ok(clientRefField, "Orders must have client_id field");
    assert.equal(clientRefField.typeLower, "relation");
    assert.equal(clientRefField.targetModule, "clients");
    assert.equal(clientRefField.targetField, "id");

    const orderClientRel = bp.relationships.find(
      (r) => r.sourceModule === "orders" && r.targetModule === "clients"
    );
    assert.ok(orderClientRel, "Explicit order->client relationship must exist");
    assert.equal(orderClientRel.targetField, "id");
  });

  // Test 3: Appointments correctly reference clients and orders
  await t.test("3. Appointments correctly reference clients and orders", () => {
    const prompt = "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments.";
    const bp = buildDynamicBlueprintFromPrompt(prompt);

    const apptMod = bp.modules.find((m) => m.slug === "appointments");
    assert.ok(apptMod, "Appointments module must exist");

    const clientRef = apptMod.fields.find((f) => f.name === "client_id");
    assert.ok(clientRef);
    assert.equal(clientRef.typeLower, "relation");
    assert.equal(clientRef.targetModule, "clients");

    const orderRef = apptMod.fields.find((f) => f.name === "order_id");
    assert.ok(orderRef);
    assert.equal(orderRef.typeLower, "relation");
    assert.equal(orderRef.targetModule, "orders");
  });

  // Test 4: Relationship types are consistent
  await t.test("4. Relationship types and references are consistent", () => {
    const prompt = "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments.";
    const bp = buildDynamicBlueprintFromPrompt(prompt);

    for (const rel of bp.relationships) {
      assert.ok(rel.sourceModule);
      assert.ok(rel.targetModule);
      assert.equal(rel.targetField, "id");
      assert.ok(rel.cardinality);

      const src = bp.modules.find((m) => m.slug === rel.sourceModule);
      const tgt = bp.modules.find((m) => m.slug === rel.targetModule);
      assert.ok(src, `Source module ${rel.sourceModule} must exist`);
      assert.ok(tgt, `Target module ${rel.targetModule} must exist`);
    }
  });

  // Test 5: Invalid relationship targets are rejected
  await t.test("5. Invalid relationship targets are rejected", () => {
    const invalidBlueprint = {
      workspaceName: "Invalid Rel Studio",
      modules: [
        {
          name: "Orders",
          slug: "orders",
          fields: [
            {
              name: "client_id",
              label: "Client",
              type: "relation",
              targetModule: "non_existent_clients",
              targetField: "id",
            },
          ],
        },
      ],
      relationships: [
        {
          sourceModule: "orders",
          sourceField: "client_id",
          targetModule: "non_existent_clients",
          targetField: "id",
        },
      ],
    };

    const res = validateBlueprint(invalidBlueprint);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("non_existent_clients")));
  });

  // Test 6: Unsupported field types are rejected
  await t.test("6. Unsupported field types are rejected", () => {
    const badTypeBlueprint = {
      workspaceName: "Bad Types Shop",
      modules: [
        {
          name: "Items",
          slug: "items",
          fields: [
            {
              name: "corrupted_field",
              label: "Bad Field",
              type: "executable_binary_blob",
            },
          ],
        },
      ],
    };

    const res = validateBlueprint(badTypeBlueprint);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Unsupported field type")));
  });

  // Test 7: Select fields have valid options
  await t.test("7. Select fields without options are rejected", () => {
    const emptySelectBlueprint = {
      workspaceName: "Empty Select Shop",
      modules: [
        {
          name: "Items",
          slug: "items",
          fields: [
            {
              name: "status",
              label: "Status",
              type: "select",
              options: [],
            },
          ],
        },
      ],
    };

    const res = validateBlueprint(emptySelectBlueprint);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("at least one valid option")));
  });

  // Test 8: Duplicate module and field identifiers are rejected
  await t.test("8. Duplicate module and field identifiers are rejected", () => {
    const dupBlueprint = {
      workspaceName: "Duplicate Test Shop",
      modules: [
        {
          name: "Clients",
          slug: "clients",
          fields: [
            { name: "email", label: "Email", type: "email" },
            { name: "email", label: "Email Duplicate", type: "email" },
          ],
        },
        {
          name: "Clients",
          slug: "clients",
          fields: [{ name: "name", label: "Name", type: "text" }],
        },
      ],
    };

    const res = validateBlueprint(dupBlueprint);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Duplicate module") || e.includes("Duplicate field")));
  });

  // Test 9: Invalid blueprints cannot be provisioned
  await t.test("9. Invalid blueprints cannot be provisioned", async () => {
    await assert.rejects(
      async () => {
        await provisionWorkspace({
          userId: user1.id,
          blueprint: {
            workspaceName: "Broken",
            modules: [],
          },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /invalid blueprint/i);
        return true;
      }
    );
  });

  // Test 10: Blueprint edits in the review UI reach backend and validate
  await t.test("10. Blueprint edits in review UI reach backend and validate", () => {
    const baseBp = buildDynamicBlueprintFromPrompt(
      "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments."
    );

    // Simulate user editing title and removing a module or adding a field
    const editedBp = {
      ...baseBp,
      workspaceName: "Sinclair Bespoke Atelier",
      modules: baseBp.modules.map((m) =>
        m.slug === "clients"
          ? {
              ...m,
              fields: [
                ...m.fields,
                { id: "f_vip", name: "vip_status", label: "VIP Tier", type: "Select", options: ["Standard", "Gold", "Savile Row VIP"] },
              ],
            }
          : m
      ),
    };

    const val = validateBlueprint(editedBp);
    assert.equal(val.valid, true);
    assert.equal(val.normalized.workspaceName, "Sinclair Bespoke Atelier");
    const clientMod = val.normalized.modules.find((m) => m.slug === "clients");
    assert.ok(clientMod.fields.some((f) => f.name === "vip_status"));
  });

  // Test 11: Valid tailoring blueprints can be provisioned and used for CRUD
  let tailoringWorkspaceId;
  let clientRecordId;
  let orderRecordId;

  await t.test("11. Valid tailoring blueprint can be provisioned and used for CRUD", async () => {
    const tailoringBp = buildDynamicBlueprintFromPrompt(
      "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments."
    );

    const provResult = await provisionWorkspace({
      userId: user1.id,
      blueprint: tailoringBp,
    });

    assert.ok(provResult.workspaceId);
    tailoringWorkspaceId = provResult.workspaceId;
    createdWorkspaceIds.push(tailoringWorkspaceId);

    const ws = await getWorkspaceById(tailoringWorkspaceId, user1.id);
    const clientsMod = ws.modules.find((m) => m.slug === "clients");
    const ordersMod = ws.modules.find((m) => m.slug === "orders");
    assert.ok(clientsMod);
    assert.ok(ordersMod);

    // 1. Create Client
    const clientRec = await createRecord({
      workspaceId: tailoringWorkspaceId,
      moduleId: clientsMod.id,
      userId: user1.id,
      data: {
        first_name: "Arthur",
        last_name: "Pendleton",
        email: "arthur@example.co.uk",
        phone: "+44 20 7946 0912",
        address: "12 Mayfair Gardens, London",
      },
    });

    assert.ok(clientRec.id);
    assert.match(clientRec.id, /^rec_/);
    clientRecordId = clientRec.id;

    // 2. Create Order referencing Client
    const orderRec = await createRecord({
      workspaceId: tailoringWorkspaceId,
      moduleId: ordersMod.id,
      userId: user1.id,
      data: {
        client_id: clientRecordId,
        suit_type: "Three-Piece Suit",
        order_date: "2026-10-12",
        price: 2450.0,
        order_status: "Confirmed",
      },
    });

    assert.ok(orderRec.id);
    assert.equal(orderRec.client_id, clientRecordId);
    orderRecordId = orderRec.id;

    // 3. Foreign key protection: attempting to delete client while order references it fails
    await assert.rejects(
      async () => {
        await deleteRecord({
          workspaceId: tailoringWorkspaceId,
          moduleId: clientsMod.id,
          userId: user1.id,
          recordId: clientRecordId,
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /referenced by other records/i);
        return true;
      }
    );
  });

  // Test 12: Another workspace's records cannot be referenced
  await t.test("12. Another workspace's records cannot be referenced (cross-workspace reference rejected)", async () => {
    // Provision workspace for user 2 (Bakery)
    const bakeryBp = buildDynamicBlueprintFromPrompt(
      "Artisan bakery making sourdough bread and custom wedding cakes with ingredient inventories."
    );

    const prov2 = await provisionWorkspace({
      userId: user2.id,
      blueprint: bakeryBp,
    });
    createdWorkspaceIds.push(prov2.workspaceId);

    const ws2 = await getWorkspaceById(prov2.workspaceId, user2.id);
    const customers2 = ws2.modules.find((m) => m.slug === "customers");

    // Create customer in workspace 2
    const cust2Rec = await createRecord({
      workspaceId: prov2.workspaceId,
      moduleId: customers2.id,
      userId: user2.id,
      data: {
        full_name: "Bakery Customer Bob",
        email: "bob.baker@example.com",
        phone: "+1 555 123 4567",
      },
    });

    // In tailoring workspace 1, attempt to create an order referencing user 2's customer ID
    const ws1 = await getWorkspaceById(tailoringWorkspaceId, user1.id);
    const ordersMod1 = ws1.modules.find((m) => m.slug === "orders");

    await assert.rejects(
      async () => {
        await createRecord({
          workspaceId: tailoringWorkspaceId,
          moduleId: ordersMod1.id,
          userId: user1.id,
          data: {
            client_id: cust2Rec.id, // ID from workspace 2!
            suit_type: "Tuxedo",
            order_date: "2026-10-12",
            price: 1500.0,
            order_status: "Draft",
          },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /does not exist in module/i);
        return true;
      }
    );
  });

  // Test 13: Second business description produces different relevant blueprint
  await t.test("13. Second business description produces different relevant blueprint", () => {
    const medicalBp = buildDynamicBlueprintFromPrompt(
      "A pediatric medical clinic managing patient appointments, pediatric vaccinations, and doctor prescriptions."
    );

    const tailoringBp = buildDynamicBlueprintFromPrompt(
      "We run a bespoke tailoring studio managing custom client measurements, bespoke suit orders, fabric inventory, and fitting appointments."
    );

    assert.notEqual(medicalBp.workspaceName, tailoringBp.workspaceName);
    assert.ok(medicalBp.modules.some((m) => m.slug.includes("patient")));
    assert.ok(medicalBp.modules.some((m) => m.slug.includes("prescription")));
    assert.ok(!medicalBp.modules.some((m) => m.slug.includes("fabric")));
  });

  // Test 14: Generation failures do not create partially provisioned workspaces
  await t.test("14. Generation failures do not create partially provisioned workspaces", async () => {
    const brokenBlueprint = {
      workspaceName: "Doomed Workspace",
      modules: [
        {
          name: "Valid Mod",
          slug: "valid_mod",
          fields: [{ name: "title", label: "Title", type: "text" }],
        },
        {
          name: "Broken Mod",
          slug: "broken_mod",
          fields: [{ name: "bad_rel", label: "Bad Rel", type: "relation", targetModule: "missing_target" }],
        },
      ],
    };

    const initialCount = await prisma.workspace.count({ where: { userId: user1.id } });

    await assert.rejects(
      async () => {
        await provisionWorkspace({
          userId: user1.id,
          blueprint: brokenBlueprint,
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );

    const finalCount = await prisma.workspace.count({ where: { userId: user1.id } });
    assert.equal(finalCount, initialCount, "No orphaned or partial workspace record should remain");
  });
});
