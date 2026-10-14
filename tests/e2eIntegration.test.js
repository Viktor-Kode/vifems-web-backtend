import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/database.js";
import {
  generateWorkspaceBlueprint,
  validateBlueprint,
} from "../src/services/vifeAiService.js";
import {
  createWorkspaceGeneration,
  getWorkspaceGeneration,
  provisionWorkspace,
  getWorkspaceById,
  getWorkspaceOverview,
  createRecord,
  listRecords,
  getRecord,
  updateRecord,
  deleteRecord,
} from "../src/services/workspaceService.js";
import { registerUser, createToken, verifyToken } from "../src/services/authService.js";

test("VifeMS End-to-End Integration Test Suite", async (t) => {
  let userA, userB;
  let workspaceAId, workspaceBId;
  const createdWorkspaceIds = [];

  t.before(async () => {
    // Create test users
    userA = await registerUser({
      fullName: "E2E Alice Founder",
      email: `alice_e2e_${Date.now()}@example.com`,
      password: "SuperSecurePassword123!",
    });

    userB = await registerUser({
      fullName: "E2E Bob Competitor",
      email: `bob_e2e_${Date.now()}@example.com`,
      password: "SuperSecurePassword123!",
    });
  });

  t.after(async () => {
    // Teardown created workspaces and dynamic tables
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

    if (userA) await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    if (userB) await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
  });

  // ============================================================
  // Test 1: Complete Onboarding Journey
  // ============================================================
  await t.test("Test 1: Complete onboarding flow", async () => {
    // 1. Submit valid business description
    const desc = "I manage a boutique creative agency where clients commission branding projects and we bill monthly milestone invoices.";
    const genResult = await createWorkspaceGeneration({
      userId: userA.id,
      description: desc,
    });

    assert.ok(genResult.generationId, "Generation ID must be returned");
    assert.equal(genResult.status, "REVIEW_READY");
    assert.ok(genResult.blueprint.modules.length > 0, "Blueprint must have modules");

    // 2. Retrieve draft
    const draft = await getWorkspaceGeneration({
      generationId: genResult.generationId,
      userId: userA.id,
    });
    assert.equal(draft.generationId, genResult.generationId);

    // 3. User reviews and modifies the blueprint
    const reviewedBlueprint = JSON.parse(JSON.stringify(draft.blueprint));
    reviewedBlueprint.workspaceName = "Aura Creative Studio";
    if (reviewedBlueprint.modules[0]) {
      reviewedBlueprint.modules[0].name = "Agency Clients";
    }

    // 4. Provision workspace with user's reviewed blueprint
    const provResult = await provisionWorkspace({
      userId: userA.id,
      generationId: genResult.generationId,
      blueprint: reviewedBlueprint,
    });

    assert.ok(provResult.workspaceId, "Must return created workspace ID");
    assert.equal(provResult.status, "ACTIVE");
    workspaceAId = provResult.workspaceId;
    createdWorkspaceIds.push(workspaceAId);

    // 5. Verify persisted workspace and modules
    const loadedWs = await getWorkspaceById(workspaceAId, userA.id);
    assert.equal(loadedWs.name, "Aura Creative Studio");
    assert.ok(loadedWs.modules.length > 0);

    // 6. Verify overview metrics endpoint
    const overview = await getWorkspaceOverview({
      workspaceId: workspaceAId,
      userId: userA.id,
    });
    assert.equal(overview.workspaceId, workspaceAId);
    assert.equal(overview.totalRecords, 0);
  });

  // ============================================================
  // Test 2: Persistence & CRUD operations
  // ============================================================
  await t.test("Test 2: Persistence of dynamic records and updates", async () => {
    const ws = await getWorkspaceById(workspaceAId, userA.id);
    const primaryModule = ws.modules[0];

    // Build schema-compliant test record data
    const initialData = {};
    for (const f of primaryModule.fields) {
      if (f.typeLower === "relation") continue;
      if (f.typeLower === "number" || f.typeLower === "decimal" || f.typeLower === "currency") {
        initialData[f.name] = 100;
      } else if (f.typeLower === "boolean") {
        initialData[f.name] = true;
      } else if (f.typeLower === "date") {
        initialData[f.name] = "2026-10-15";
      } else if (f.typeLower === "select") {
        initialData[f.name] = f.options?.[0] || "Active";
      } else if (f.typeLower === "email") {
        initialData[f.name] = "contact@acme.example";
      } else {
        initialData[f.name] = "Acme Holdings";
      }
    }

    // 1. Create a record
    const created = await createRecord({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      data: initialData,
    });

    assert.ok(created.id, "Record ID must be created");
    assert.equal(created.workspace_id, workspaceAId);

    // 2. Fetch record directly
    const fetched = await getRecord({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      recordId: created.id,
    });
    assert.equal(fetched.id, created.id);

    // 3. Edit record
    const updatedData = { ...initialData };
    const firstTextField = primaryModule.fields.find(
      (f) => f.typeLower === "text" || f.typeLower === "long_text"
    );
    if (firstTextField) {
      updatedData[firstTextField.name] = "Acme Global International";
    }

    const updated = await updateRecord({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      recordId: created.id,
      data: updatedData,
    });
    assert.equal(updated.id, created.id);

    // 4. Verify update persisted in database
    const refreshed = await getRecord({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      recordId: created.id,
    });
    if (firstTextField) {
      assert.equal(
        refreshed[firstTextField.name] || refreshed.data?.[firstTextField.name],
        "Acme Global International"
      );
    }

    // 5. Test search in listRecords
    const searchMatch = await listRecords({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      search: "Acme",
    });
    assert.ok(searchMatch.records.length >= 1);

    const searchNoMatch = await listRecords({
      workspaceId: workspaceAId,
      moduleId: primaryModule.id,
      userId: userA.id,
      search: "NonexistentQueryXYZ999",
    });
    assert.equal(searchNoMatch.records.length, 0);
  });

  // ============================================================
  // Test 3: Relationships & Referential Integrity
  // ============================================================
  await t.test("Test 3: Relationships across dynamic models", async () => {
    // Provision custom schema with explicit parent -> child relation
    const customBlueprint = {
      workspaceName: "Relational Test Workspace",
      description: "Testing explicit foreign keys",
      modules: [
        {
          id: "ent_clients",
          name: "Clients",
          slug: "clients",
          fields: [
            { id: "f_c1", name: "client_name", label: "Client Name", type: "Text", required: true },
            { id: "f_c2", name: "contact_email", label: "Email", type: "Email" },
          ],
        },
        {
          id: "ent_projects",
          name: "Projects",
          slug: "projects",
          fields: [
            { id: "f_p1", name: "project_title", label: "Project Title", type: "Text", required: true },
            {
              id: "f_p2",
              name: "client_id",
              label: "Client",
              type: "Relation",
              targetModule: "clients",
              required: true,
            },
          ],
        },
      ],
      relationships: [
        {
          sourceModule: "projects",
          sourceField: "client_id",
          targetModule: "clients",
          targetField: "id",
          cardinality: "many-to-one",
        },
      ],
    };

    const wsResult = await provisionWorkspace({
      userId: userA.id,
      blueprint: customBlueprint,
    });
    const wsId = wsResult.workspaceId;
    createdWorkspaceIds.push(wsId);

    const ws = await getWorkspaceById(wsId, userA.id);
    const clientMod = ws.modules.find((m) => m.slug === "clients");
    const projMod = ws.modules.find((m) => m.slug === "projects");

    // 1. Create parent record (Client)
    const clientRec = await createRecord({
      workspaceId: wsId,
      moduleId: clientMod.id,
      userId: userA.id,
      data: {
        client_name: "Starlight Corp",
        contact_email: "info@starlight.example",
      },
    });
    assert.ok(clientRec.id);

    // 2. Create child record (Project) referencing valid parent ID
    const projRec = await createRecord({
      workspaceId: wsId,
      moduleId: projMod.id,
      userId: userA.id,
      data: {
        project_title: "Solar Rebrand 2026",
        client_id: clientRec.id,
      },
    });
    assert.ok(projRec.id);
    assert.equal(projRec.client_id, clientRec.id);

    // 3. Reject invalid relationship reference (non-existent record)
    await assert.rejects(
      async () => {
        await createRecord({
          workspaceId: wsId,
          moduleId: projMod.id,
          userId: userA.id,
          data: {
            project_title: "Invalid Project",
            client_id: "rec_fake_nonexistent_id",
          },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /invalid reference/i);
        return true;
      }
    );

    // 4. Reject deleting parent record while referenced by child (foreign key constraint)
    await assert.rejects(
      async () => {
        await deleteRecord({
          workspaceId: wsId,
          moduleId: clientMod.id,
          userId: userA.id,
          recordId: clientRec.id,
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /referenced by other records/i);
        return true;
      }
    );

    // 5. Delete child first, then deleting parent succeeds
    await deleteRecord({
      workspaceId: wsId,
      moduleId: projMod.id,
      userId: userA.id,
      recordId: projRec.id,
    });

    const delParentResult = await deleteRecord({
      workspaceId: wsId,
      moduleId: clientMod.id,
      userId: userA.id,
      recordId: clientRec.id,
    });
    assert.equal(delParentResult.success, true);
  });

  // ============================================================
  // Test 4: Tenant Isolation & Cross-Workspace Security
  // ============================================================
  await t.test("Test 4: Strict tenant isolation between User A and User B", async () => {
    // Provision workspace for User B
    const bpB = {
      workspaceName: "Bob Private Operations",
      description: "Confidential records for user B",
      modules: [
        {
          id: "ent_secrets",
          name: "Secrets",
          slug: "secrets",
          fields: [{ id: "f_s1", name: "title", label: "Title", type: "Text", required: true }],
        },
      ],
    };

    const wsBResult = await provisionWorkspace({
      userId: userB.id,
      blueprint: bpB,
    });
    workspaceBId = wsBResult.workspaceId;
    createdWorkspaceIds.push(workspaceBId);

    // 1. User B cannot read User A's workspace
    await assert.rejects(
      async () => {
        await getWorkspaceById(workspaceAId, userB.id);
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /access denied/i);
        return true;
      }
    );

    // 2. User A cannot read User B's workspace
    await assert.rejects(
      async () => {
        await getWorkspaceById(workspaceBId, userA.id);
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );

    // 3. User B cannot list records in User A's workspace
    const wsA = await getWorkspaceById(workspaceAId, userA.id);
    await assert.rejects(
      async () => {
        await listRecords({
          workspaceId: workspaceAId,
          moduleId: wsA.modules[0].id,
          userId: userB.id,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  // ============================================================
  // Test 5: Failure Recovery & Input Preservation
  // ============================================================
  await t.test("Test 5: Explicit failure recovery handling", async () => {
    // 1. AI generation rejects short description (< 50 chars)
    await assert.rejects(
      async () => {
        await generateWorkspaceBlueprint("Too short");
      },
      (err) => {
        assert.match(err.message, /at least 50 characters/i);
        return true;
      }
    );

    // 2. Invalid blueprint rejected before provisioning
    const invalidBlueprint = {
      workspaceName: "Invalid Blueprint",
      modules: [
        {
          id: "mod_invalid",
          name: "Invalid",
          slug: "invalid",
          fields: [
            { id: "f_bad", name: "broken", type: "unsupported_magic_type" },
          ],
        },
      ],
    };

    await assert.rejects(
      async () => {
        await provisionWorkspace({
          userId: userA.id,
          blueprint: invalidBlueprint,
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /invalid blueprint/i);
        return true;
      }
    );

    // 3. Expired or unauthenticated request rejected
    await assert.rejects(
      async () => {
        await getWorkspaceById(workspaceAId, null);
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  // ============================================================
  // Test 6: Diverse Business Schemas (Consulting vs Retailer)
  // ============================================================
  await t.test("Test 6: Multi-schema support (Consulting & Retailer)", async () => {
    // Schema 1: Consulting Business
    const consultingBlueprint = {
      workspaceName: "Apex Strategic Consulting",
      description: "Advising enterprise clients on growth and digital transformation.",
      modules: [
        {
          id: "ent_clients",
          name: "Clients",
          slug: "clients",
          fields: [
            { id: "f_1", name: "company_name", label: "Company", type: "Text", required: true },
            { id: "f_2", name: "industry", label: "Industry", type: "Select", options: ["Finance", "Healthcare", "Tech"] },
          ],
        },
        {
          id: "ent_projects",
          name: "Projects",
          slug: "projects",
          fields: [
            { id: "f_3", name: "title", label: "Project Title", type: "Text", required: true },
            { id: "f_4", name: "client_id", label: "Client", type: "Relation", targetModule: "clients", required: true },
            { id: "f_5", name: "budget", label: "Budget", type: "Currency" },
          ],
        },
        {
          id: "ent_invoices",
          name: "Invoices",
          slug: "invoices",
          fields: [
            { id: "f_6", name: "invoice_number", label: "Invoice #", type: "Text", required: true },
            { id: "f_7", name: "project_id", label: "Project", type: "Relation", targetModule: "projects", required: true },
            { id: "f_8", name: "amount", label: "Amount", type: "Currency", required: true },
            { id: "f_9", name: "paid", label: "Paid", type: "Boolean" },
          ],
        },
      ],
      relationships: [
        { sourceModule: "projects", sourceField: "client_id", targetModule: "clients", targetField: "id" },
        { sourceModule: "invoices", sourceField: "project_id", targetModule: "projects", targetField: "id" },
      ],
    };

    const wsConsultingResult = await provisionWorkspace({
      userId: userA.id,
      blueprint: consultingBlueprint,
    });
    createdWorkspaceIds.push(wsConsultingResult.workspaceId);
    const wsConsulting = await getWorkspaceById(wsConsultingResult.workspaceId, userA.id);

    assert.equal(wsConsulting.modules.length, 3);
    assert.deepEqual(
      wsConsulting.modules.map((m) => m.slug).sort(),
      ["clients", "invoices", "projects"]
    );

    // Schema 2: Electronics Retailer
    const retailBlueprint = {
      workspaceName: "Volt Electro Mart",
      description: "Retail electronic goods, suppliers, inventory stock, customer sales.",
      modules: [
        {
          id: "ent_customers",
          name: "Customers",
          slug: "customers",
          fields: [
            { id: "f_r1", name: "customer_name", label: "Name", type: "Text", required: true },
            { id: "f_r2", name: "phone", label: "Phone", type: "Phone" },
          ],
        },
        {
          id: "ent_suppliers",
          name: "Suppliers",
          slug: "suppliers",
          fields: [
            { id: "f_r3", name: "supplier_name", label: "Supplier Name", type: "Text", required: true },
          ],
        },
        {
          id: "ent_products",
          name: "Products",
          slug: "products",
          fields: [
            { id: "f_r4", name: "product_name", label: "Product Name", type: "Text", required: true },
            { id: "f_r5", name: "supplier_id", label: "Supplier", type: "Relation", targetModule: "suppliers", required: true },
            { id: "f_r6", name: "unit_price", label: "Unit Price", type: "Currency", required: true },
            { id: "f_r7", name: "stock_quantity", label: "Stock Quantity", type: "Number" },
          ],
        },
        {
          id: "ent_sales",
          name: "Sales",
          slug: "sales",
          fields: [
            { id: "f_r8", name: "customer_id", label: "Customer", type: "Relation", targetModule: "customers", required: true },
            { id: "f_r9", name: "sale_date", label: "Sale Date", type: "Date" },
            { id: "f_r10", name: "total_amount", label: "Total Amount", type: "Currency" },
          ],
        },
      ],
      relationships: [
        { sourceModule: "products", sourceField: "supplier_id", targetModule: "suppliers", targetField: "id" },
        { sourceModule: "sales", sourceField: "customer_id", targetModule: "customers", targetField: "id" },
      ],
    };

    const wsRetailResult = await provisionWorkspace({
      userId: userA.id,
      blueprint: retailBlueprint,
    });
    createdWorkspaceIds.push(wsRetailResult.workspaceId);
    const wsRetail = await getWorkspaceById(wsRetailResult.workspaceId, userA.id);

    assert.equal(wsRetail.modules.length, 4);
    assert.deepEqual(
      wsRetail.modules.map((m) => m.slug).sort(),
      ["customers", "products", "sales", "suppliers"]
    );
  });
});
