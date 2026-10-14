import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/database.js";
import {
  createWorkspaceGeneration,
  getWorkspaceGeneration,
  provisionWorkspace,
  getWorkspaceById,
  createRecord,
  listRecords,
  deleteRecord,
} from "../src/services/workspaceService.js";

test("Workspace Service & Dynamic PostgreSQL Provisioning Tests", async (t) => {
  // Test user A and test user B
  let userA, userB;
  let testWorkspaceId;
  let testModuleId;
  let testGenerationId;

  t.before(async () => {
    // Create isolated test users
    userA = await prisma.user.create({
      data: {
        fullName: "Test Alice",
        email: `alice_${Date.now()}@example.com`,
      },
    });

    userB = await prisma.user.create({
      data: {
        fullName: "Test Bob",
        email: `bob_${Date.now()}@example.com`,
      },
    });
  });

  t.after(async () => {
    // Clean up created test resources
    if (userA) {
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    }
    if (userB) {
      await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    }
  });

  await t.test("rejects unauthenticated generation requests", async () => {
    await assert.rejects(
      async () => {
        await createWorkspaceGeneration({
          userId: null,
          description: "I run an auto repair shop with mechanics and spare parts tracking.",
        });
      },
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  await t.test("creates blueprint draft for authenticated user A", async () => {
    const desc = "I operate a small dental clinic where patients book appointments, dentists write prescriptions, and staff bill treatments.";
    const result = await createWorkspaceGeneration({
      userId: userA.id,
      description: desc,
    });

    assert.ok(result.generationId);
    assert.equal(result.status, "REVIEW_READY");
    assert.ok(result.blueprint.workspaceName);
    assert.ok(result.blueprint.modules.length > 0);

    testGenerationId = result.generationId;
  });

  await t.test("enforces tenant ownership: user B cannot access user A's draft", async () => {
    await assert.rejects(
      async () => {
        await getWorkspaceGeneration({
          generationId: testGenerationId,
          userId: userB.id,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /access denied/i);
        return true;
      }
    );
  });

  await t.test("provisions real PostgreSQL tables for user A's blueprint", async () => {
    const draft = await getWorkspaceGeneration({
      generationId: testGenerationId,
      userId: userA.id,
    });

    const provisionResult = await provisionWorkspace({
      userId: userA.id,
      generationId: testGenerationId,
      blueprint: draft.blueprint,
    });

    assert.ok(provisionResult.workspaceId);
    assert.equal(provisionResult.status, "ACTIVE");
    testWorkspaceId = provisionResult.workspaceId;

    // Verify workspace and provisioned modules in database
    const ws = await getWorkspaceById(testWorkspaceId, userA.id);
    assert.equal(ws.name, draft.blueprint.workspaceName);
    assert.ok(ws.modules.length > 0);
    testModuleId = ws.modules[0].id;

    // Verify physical PostgreSQL table exists
    const checkTable = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
      ws.modules[0].tableName
    );
    assert.equal(checkTable.length, 1);
  });

  await t.test("idempotent launch: re-provisioning draft returns existing workspace", async () => {
    const secondLaunch = await provisionWorkspace({
      userId: userA.id,
      generationId: testGenerationId,
    });

    assert.equal(secondLaunch.workspaceId, testWorkspaceId);
  });

  await t.test("enforces tenant ownership: user B cannot access user A's workspace", async () => {
    await assert.rejects(
      async () => {
        await getWorkspaceById(testWorkspaceId, userB.id);
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  await t.test("CRUD: creates, lists, and deletes records in provisioned PostgreSQL table", async () => {
    const ws = await getWorkspaceById(testWorkspaceId, userA.id);
    const targetModule = ws.modules.find((m) => m.slug.includes("patient") || m.slug.includes("client")) || ws.modules[0];

    // 1. Create Record
    const createdRecord = await createRecord({
      workspaceId: testWorkspaceId,
      moduleId: targetModule.id,
      userId: userA.id,
      data: {
        full_name: "Jane Doe Patient",
        email: "jane.doe@example.com",
        phone: "+1 555 987 6543",
      },
    });

    assert.ok(createdRecord.id);
    assert.equal(createdRecord.workspace_id, testWorkspaceId);

    // 2. List Records
    const listResult = await listRecords({
      workspaceId: testWorkspaceId,
      moduleId: targetModule.id,
      userId: userA.id,
    });

    assert.ok(listResult.records.length >= 1);
    const found = listResult.records.find((r) => r.id === createdRecord.id);
    assert.ok(found);

    // 3. User B cannot list user A's records
    await assert.rejects(
      async () => {
        await listRecords({
          workspaceId: testWorkspaceId,
          moduleId: targetModule.id,
          userId: userB.id,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );

    // 4. Delete Record
    const delResult = await deleteRecord({
      workspaceId: testWorkspaceId,
      moduleId: targetModule.id,
      userId: userA.id,
      recordId: createdRecord.id,
    });
    assert.equal(delResult.success, true);
  });
});
