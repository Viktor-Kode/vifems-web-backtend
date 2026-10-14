import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/database.js";
import { registerUser } from "../src/services/authService.js";
import { provisionWorkspace, createRecord, getWorkspaceById } from "../src/services/workspaceService.js";
import {
  getFinancialCapabilities,
  createInvoice,
  recordPayment,
  listInvoices,
  getInvoiceById,
  listPayments,
  listReceipts,
  getReceiptById,
  updateInvoiceStatus,
  getInvoicePdfBuffer,
  getReceiptPdfBuffer,
  roundTo2,
} from "../src/services/financialService.js";
import { detectFinancialCapabilities } from "../src/services/financialDetection.js";

test("Universal Invoice & Receipt Financial Engine Suite", async (t) => {
  let userA, userB;
  let bakeryWorkspaceId, consultingWorkspaceId, autoWorkspaceId, nonFinancialWorkspaceId;
  const createdWorkspaceIds = [];

  t.before(async () => {
    userA = await registerUser({
      fullName: "Financial Founder A",
      email: `fin_alice_${Date.now()}@example.com`,
      password: "SuperSecurePassword123!",
    });

    userB = await registerUser({
      fullName: "Financial Tenant B",
      email: `fin_bob_${Date.now()}@example.com`,
      password: "SuperSecurePassword123!",
    });
  });

  t.after(async () => {
    for (const wsId of createdWorkspaceIds) {
      try {
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
      } catch (_) {}
    }

    if (userA) await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    if (userB) await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
  });

  // 1. Bakery workspace invoice linked to real customer order
  await t.test("Scenario 1: Bakery workspace generates an invoice linked to a real customer order", async () => {
    const bakeryBlueprint = {
      workspaceName: "Sweet Delights Artisan Bakery",
      description: "Artisan bakery managing custom cake orders, ingredients, and customer deposits.",
      modules: [
        {
          name: "Customers",
          slug: "customers",
          fields: [
            { name: "full_name", label: "Full Name", type: "Text", required: true },
            { name: "email", label: "Email", type: "Email", required: true },
            { name: "phone", label: "Phone", type: "Phone", required: false },
          ],
        },
        {
          name: "Orders",
          slug: "orders",
          fields: [
            { name: "customer_id", label: "Customer", type: "Relation", targetModule: "customers", targetField: "id", required: true },
            { name: "cake_type", label: "Cake Type", type: "Text", required: true },
            { name: "order_total", label: "Order Total (USD)", type: "Currency", required: true },
            { name: "delivery_date", label: "Delivery Date", type: "Date", required: true },
          ],
        },
      ],
      relationships: [
        { sourceModule: "orders", sourceField: "customer_id", targetModule: "customers", targetField: "id", cardinality: "many-to-one" },
      ],
    };

    const prov = await provisionWorkspace({ userId: userA.id, blueprint: bakeryBlueprint });
    bakeryWorkspaceId = prov.workspaceId;
    createdWorkspaceIds.push(bakeryWorkspaceId);

    const ws = await getWorkspaceById(bakeryWorkspaceId, userA.id);
    const customerMod = ws.modules.find((m) => m.slug === "customers");
    const orderMod = ws.modules.find((m) => m.slug === "orders");

    // Create real customer
    const customer = await createRecord({
      workspaceId: bakeryWorkspaceId,
      moduleId: customerMod.id,
      userId: userA.id,
      data: {
        full_name: "Sarah Miller",
        email: "sarah.m@example.com",
        phone: "+1 555 234 5678",
      },
    });

    // Create real order
    const order = await createRecord({
      workspaceId: bakeryWorkspaceId,
      moduleId: orderMod.id,
      userId: userA.id,
      data: {
        customer_id: customer.id,
        cake_type: "3-Tier Red Velvet Wedding Cake",
        order_total: 450.0,
        delivery_date: "2026-11-15",
      },
    });

    // Generate invoice linked to order
    const invoice = await createInvoice({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      data: {
        sourceModuleSlug: "orders",
        sourceRecordId: order.id,
        notes: "Deposit due upon order confirmation.",
        lineItems: [
          { description: "3-Tier Red Velvet Wedding Cake with Fondant Florals", quantity: 1, unitPrice: 400.0 },
          { description: "Chilled Delivery & Setup Fee", quantity: 1, unitPrice: 50.0 },
        ],
      },
    });

    assert.ok(invoice.id);
    assert.match(invoice.invoiceNumber, /^INV-\d{4}-\d{4}$/);
    assert.equal(invoice.payerName, "Sarah Miller");
    assert.equal(invoice.payerEmail, "sarah.m@example.com");
    assert.equal(Number(invoice.subtotal), 450.0);
    assert.equal(Number(invoice.totalAmount), 450.0);
    assert.equal(Number(invoice.balanceDue), 450.0);
    assert.equal(Number(invoice.amountPaid), 0.0);
    assert.equal(invoice.sourceRecordId, order.id);
  });

  // 2. Consulting workspace invoice linked to client engagement
  await t.test("Scenario 2: Consulting workspace generates invoice linked to client project engagement", async () => {
    const consultingBlueprint = {
      workspaceName: "Apex Strategy Partners",
      description: "Management consulting firm managing corporate client engagements and retainer billing.",
      modules: [
        {
          name: "Clients",
          slug: "clients",
          fields: [
            { name: "company_name", label: "Company Name", type: "Text", required: true },
            { name: "email", label: "Billing Email", type: "Email", required: true },
          ],
        },
        {
          name: "Projects",
          slug: "projects",
          fields: [
            { name: "client_id", label: "Client", type: "Relation", targetModule: "clients", targetField: "id", required: true },
            { name: "project_name", label: "Project Name", type: "Text", required: true },
            { name: "fixed_fee", label: "Contract Fee (USD)", type: "Currency", required: true },
          ],
        },
      ],
      relationships: [
        { sourceModule: "projects", sourceField: "client_id", targetModule: "clients", targetField: "id", cardinality: "many-to-one" },
      ],
    };

    const prov = await provisionWorkspace({ userId: userA.id, blueprint: consultingBlueprint });
    consultingWorkspaceId = prov.workspaceId;
    createdWorkspaceIds.push(consultingWorkspaceId);

    const ws = await getWorkspaceById(consultingWorkspaceId, userA.id);
    const clientMod = ws.modules.find((m) => m.slug === "clients");
    const projMod = ws.modules.find((m) => m.slug === "projects");

    const client = await createRecord({
      workspaceId: consultingWorkspaceId,
      moduleId: clientMod.id,
      userId: userA.id,
      data: {
        company_name: "Meridian Global FinTech",
        email: "ap@meridianglobal.com",
      },
    });

    const project = await createRecord({
      workspaceId: consultingWorkspaceId,
      moduleId: projMod.id,
      userId: userA.id,
      data: {
        client_id: client.id,
        project_name: "Q4 Regulatory Compliance Audit",
        fixed_fee: 15000.0,
      },
    });

    const invoice = await createInvoice({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      data: {
        sourceModuleSlug: "projects",
        sourceRecordId: project.id,
        subtotal: 15000.0,
        discount: 1000.0,
        tax: 700.0,
        notes: "Milestone 1 invoice. Net 30 payment terms.",
      },
    });

    assert.ok(invoice.id);
    assert.equal(invoice.payerName, "Meridian Global FinTech");
    assert.equal(Number(invoice.subtotal), 15000.0);
    assert.equal(Number(invoice.discount), 1000.0);
    assert.equal(Number(invoice.tax), 700.0);
    assert.equal(Number(invoice.totalAmount), 14700.0);
    assert.equal(Number(invoice.balanceDue), 14700.0);
  });

  // 3. Automobile repair workspace invoice linked to repair job
  await t.test("Scenario 3: Automobile repair workspace generates an invoice linked to a repair job", async () => {
    const autoBlueprint = {
      workspaceName: "Precision Auto Care Clinic",
      description: "Automobile repair center managing vehicle check-ins, parts, and labor billing.",
      modules: [
        {
          name: "Vehicle Owners",
          slug: "vehicle_owners",
          fields: [
            { name: "full_name", label: "Owner Name", type: "Text", required: true },
            { name: "phone", label: "Phone", type: "Phone", required: true },
            { name: "email", label: "Email", type: "Email", required: false },
          ],
        },
        {
          name: "Repair Jobs",
          slug: "repair_jobs",
          fields: [
            { name: "owner_id", label: "Vehicle Owner", type: "Relation", targetModule: "vehicle_owners", targetField: "id", required: true },
            { name: "vin_or_plate", label: "Plate Number", type: "Text", required: true },
            { name: "job_description", label: "Diagnosis / Work", type: "Text", required: true },
            { name: "estimated_cost", label: "Estimated Total (USD)", type: "Currency", required: true },
          ],
        },
      ],
      relationships: [
        { sourceModule: "repair_jobs", sourceField: "owner_id", targetModule: "vehicle_owners", targetField: "id", cardinality: "many-to-one" },
      ],
    };

    const prov = await provisionWorkspace({ userId: userA.id, blueprint: autoBlueprint });
    autoWorkspaceId = prov.workspaceId;
    createdWorkspaceIds.push(autoWorkspaceId);

    const ws = await getWorkspaceById(autoWorkspaceId, userA.id);
    const ownerMod = ws.modules.find((m) => m.slug === "vehicle_owners");
    const jobMod = ws.modules.find((m) => m.slug === "repair_jobs");

    const owner = await createRecord({
      workspaceId: autoWorkspaceId,
      moduleId: ownerMod.id,
      userId: userA.id,
      data: {
        full_name: "Marcus Vance",
        phone: "+1 555 444 8899",
        email: "marcus@vance.io",
      },
    });

    const job = await createRecord({
      workspaceId: autoWorkspaceId,
      moduleId: jobMod.id,
      userId: userA.id,
      data: {
        owner_id: owner.id,
        vin_or_plate: "CA-9X92L1",
        job_description: "Brake Rotor Replacement & Transmission Fluid Flush",
        estimated_cost: 850.0,
      },
    });

    const invoice = await createInvoice({
      workspaceId: autoWorkspaceId,
      userId: userA.id,
      data: {
        sourceModuleSlug: "repair_jobs",
        sourceRecordId: job.id,
        lineItems: [
          { description: "OEM Front Brake Rotor Pair", quantity: 1, unitPrice: 320.0 },
          { description: "Ceramic Brake Pad Set", quantity: 1, unitPrice: 130.0 },
          { description: "Synthetic Transmission Fluid (4 Quarts)", quantity: 4, unitPrice: 25.0 },
          { description: "ASE Certified Master Labor (3.0 Hours)", quantity: 3, unitPrice: 100.0 },
        ],
      },
    });

    assert.ok(invoice.id);
    assert.equal(invoice.payerName, "Marcus Vance");
    assert.equal(Number(invoice.totalAmount), 850.0);
    assert.equal(Number(invoice.balanceDue), 850.0);
  });

  // 4. Non-financial workspace receives zero financial capabilities
  await t.test("Scenario 4: Workspace with no financial operations does not receive invoice functionality", async () => {
    const nonFinancialBlueprint = {
      workspaceName: "Internal Lab Equipment Safety Tracker",
      description: "Research safety logging system tracking microscope calibrations and room cleanliness.",
      modules: [
        {
          name: "Equipment",
          slug: "equipment",
          fields: [
            { name: "device_name", label: "Device Name", type: "Text", required: true },
            { name: "model_number", label: "Model Number", type: "Text", required: true },
            { name: "status", label: "Status", type: "Select", options: ["Calibrated", "Needs Service", "Decommissioned"], required: true },
          ],
        },
        {
          name: "Logs",
          slug: "logs",
          fields: [
            { name: "equipment_id", label: "Equipment", type: "Relation", targetModule: "equipment", targetField: "id", required: true },
            { name: "log_date", label: "Log Date", type: "Date", required: true },
            { name: "operator_notes", label: "Operator Notes", type: "Long text", required: false },
          ],
        },
      ],
      relationships: [
        { sourceModule: "logs", sourceField: "equipment_id", targetModule: "equipment", targetField: "id", cardinality: "many-to-one" },
      ],
    };

    const prov = await provisionWorkspace({ userId: userA.id, blueprint: nonFinancialBlueprint });
    nonFinancialWorkspaceId = prov.workspaceId;
    createdWorkspaceIds.push(nonFinancialWorkspaceId);

    const capabilities = await getFinancialCapabilities({
      workspaceId: nonFinancialWorkspaceId,
      userId: userA.id,
    });

    assert.equal(capabilities.enabled, false);
    assert.match(capabilities.reason, /No financial or billing operations found/i);

    // Attempting to create invoice should fail gracefully
    await assert.rejects(
      async () => {
        await createInvoice({
          workspaceId: nonFinancialWorkspaceId,
          userId: userA.id,
          data: { subtotal: 100 },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /not have financial or billing operations/i);
        return true;
      }
    );
  });

  // 5. Existing payment module detection & reuse
  await t.test("Scenario 5: Existing payment/invoice module is detected and reused instead of duplicated", () => {
    const existingSchema = {
      modules: [
        {
          id: "m_orders",
          name: "Orders",
          slug: "orders",
          fields: [{ name: "amount", type: "Currency" }],
        },
        {
          id: "m_payments",
          name: "Payments",
          slug: "payments",
          fields: [
            { name: "payment_method", type: "Text" },
            { name: "amount", type: "Currency" },
          ],
        },
        {
          id: "m_invoices",
          name: "Invoices",
          slug: "invoices",
          fields: [
            { name: "invoice_number", type: "Text" },
            { name: "total", type: "Currency" },
          ],
        },
      ],
    };

    const cap = detectFinancialCapabilities(existingSchema);
    assert.equal(cap.enabled, true);
    assert.ok(cap.existingInvoiceModule);
    assert.equal(cap.existingInvoiceModule.slug, "invoices");
    assert.ok(cap.existingPaymentModule);
    assert.equal(cap.existingPaymentModule.slug, "payments");
  });

  // 6 & 7 & 8. Partial payment, multiple payments, full settlement
  let testInvoiceId;
  await t.test("Scenario 6: Confirmed partial payment produces a receipt for the actual amount received", async () => {
    const invoice = await createInvoice({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      data: {
        payerName: "Elena Rostova",
        payerEmail: "elena@example.com",
        subtotal: 150000.0,
        currency: "NGN",
        notes: "Bespoke event catering contract ₦150,000.",
      },
    });
    testInvoiceId = invoice.id;

    assert.equal(Number(invoice.totalAmount), 150000.0);
    assert.equal(Number(invoice.balanceDue), 150000.0);

    // Record 1st confirmed payment of ₦50,000
    const paymentResult = await recordPayment({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      invoiceId: testInvoiceId,
      data: {
        amount: 50000.0,
        currency: "NGN",
        paymentMethod: "Bank Transfer",
        status: "CONFIRMED",
        transactionRef: "NIP-TX-987123",
      },
    });

    const { payment, receipt, invoice: updatedInvoice } = paymentResult;

    assert.ok(payment.id);
    assert.equal(Number(payment.amount), 50000.0);
    assert.equal(payment.status, "CONFIRMED");

    // Receipt verified
    assert.ok(receipt);
    assert.ok(receipt.receiptNumber);
    assert.equal(Number(receipt.amountReceived), 50000.0);
    assert.equal(Number(receipt.previousPaidAmount), 0.0);
    assert.equal(Number(receipt.remainingBalance), 100000.0);
    assert.equal(receipt.snapshot.payerName, "Elena Rostova");

    // Invoice updated
    assert.equal(Number(updatedInvoice.amountPaid), 50000.0);
    assert.equal(Number(updatedInvoice.balanceDue), 100000.0);
    assert.equal(updatedInvoice.status, "Partially Paid");
  });

  await t.test("Scenario 7: Multiple payments update the same invoice correctly", async () => {
    // Record 2nd confirmed payment of ₦100,000
    const secondPaymentResult = await recordPayment({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      invoiceId: testInvoiceId,
      data: {
        amount: 100000.0,
        currency: "NGN",
        paymentMethod: "POS Card",
        status: "CONFIRMED",
        transactionRef: "POS-REF-445566",
      },
    });

    const { payment: p2, receipt: r2, invoice: settledInvoice } = secondPaymentResult;

    assert.ok(p2);
    assert.equal(Number(p2.amount), 100000.0);

    assert.ok(r2);
    assert.equal(Number(r2.amountReceived), 100000.0);
    assert.equal(Number(r2.previousPaidAmount), 50000.0);
    assert.equal(Number(r2.remainingBalance), 0.0);

    // Both receipts must remain independently accessible!
    const receiptsList = await listReceipts({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
    });

    const r1Found = receiptsList.receipts.find((r) => Number(r.amountReceived) === 50000.0);
    const r2Found = receiptsList.receipts.find((r) => Number(r.amountReceived) === 100000.0);

    assert.ok(r1Found, "First receipt of ₦50,000 must persist independently");
    assert.ok(r2Found, "Second receipt of ₦100,000 must persist independently");
  });

  await t.test("Scenario 8: Fully settled invoice displays zero balance and Paid status", async () => {
    const inv = await getInvoiceById({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      invoiceId: testInvoiceId,
    });

    assert.equal(Number(inv.totalAmount), 150000.0);
    assert.equal(Number(inv.amountPaid), 150000.0);
    assert.equal(Number(inv.balanceDue), 0.0);
    assert.equal(inv.status, "Paid");
    assert.equal(inv.payments.length, 2);
    assert.equal(inv.receipts.length, 2);
  });

  // 9. Pending and failed payments do not generate receipts
  await t.test("Scenario 9: Pending and failed payments do not generate valid receipts or update funds", async () => {
    const invoice = await createInvoice({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      data: {
        payerName: "Unconfirmed Payer Corp",
        subtotal: 5000.0,
      },
    });

    // 1. Pending payment
    const pendingRes = await recordPayment({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      invoiceId: invoice.id,
      data: {
        amount: 2500.0,
        status: "PENDING",
        paymentMethod: "Bank Transfer",
        transactionRef: "PENDING-WIRE-1",
      },
    });

    assert.ok(pendingRes.payment.id);
    assert.equal(pendingRes.payment.status, "PENDING");
    assert.equal(pendingRes.receipt, null, "Pending payment must not generate a receipt");
    assert.equal(Number(pendingRes.invoice.amountPaid), 0.0, "Pending payment must not increase invoice amountPaid");
    assert.equal(Number(pendingRes.invoice.balanceDue), 5000.0, "Pending payment must not reduce invoice balanceDue");

    // 2. Failed payment
    const failedRes = await recordPayment({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      invoiceId: invoice.id,
      data: {
        amount: 2500.0,
        status: "FAILED",
        paymentMethod: "Card",
        transactionRef: "DECLINED-CARD-2",
      },
    });

    assert.equal(failedRes.payment.status, "FAILED");
    assert.equal(failedRes.receipt, null, "Failed payment must not generate a receipt");
    assert.equal(Number(failedRes.invoice.amountPaid), 0.0);
  });

  // 10. Duplicate payment requests (Idempotency)
  await t.test("Scenario 10: Duplicate payment requests do not create duplicate payments or receipts", async () => {
    const invoice = await createInvoice({
      workspaceId: autoWorkspaceId,
      userId: userA.id,
      data: {
        payerName: "Idempotent Test Client",
        subtotal: 200.0,
      },
    });

    const idempotencyKey = `idem_${Date.now()}_abc123`;

    // First submission
    const firstAttempt = await recordPayment({
      workspaceId: autoWorkspaceId,
      userId: userA.id,
      invoiceId: invoice.id,
      data: {
        amount: 100.0,
        idempotencyKey,
        paymentMethod: "Cash",
        status: "CONFIRMED",
      },
    });

    assert.ok(firstAttempt.payment.id);
    assert.ok(firstAttempt.receipt.id);
    assert.equal(firstAttempt.alreadyProcessed, undefined);

    // Second submission with exact same idempotencyKey (e.g. network retry / duplicate webhook)
    const secondAttempt = await recordPayment({
      workspaceId: autoWorkspaceId,
      userId: userA.id,
      invoiceId: invoice.id,
      data: {
        amount: 100.0,
        idempotencyKey,
        paymentMethod: "Cash",
        status: "CONFIRMED",
      },
    });

    assert.equal(secondAttempt.alreadyProcessed, true);
    assert.equal(secondAttempt.payment.id, firstAttempt.payment.id);
    assert.equal(secondAttempt.receipt.id, firstAttempt.receipt.id);

    // Verify database only has 1 payment and 1 receipt
    const checkPayments = await prisma.payment.findMany({
      where: { workspaceId: autoWorkspaceId, idempotencyKey },
    });
    assert.equal(checkPayments.length, 1);
  });

  // 11. Concurrent invoice creation safe numbering
  await t.test("Scenario 11: Concurrent invoice creation does not produce duplicate invoice numbers", async () => {
    const concurrentCount = 5;
    const promises = Array.from({ length: concurrentCount }).map((_, i) =>
      createInvoice({
        workspaceId: bakeryWorkspaceId,
        userId: userA.id,
        data: {
          payerName: `Concurrent Payer ${i + 1}`,
          subtotal: 100.0 + i,
        },
      })
    );

    const createdInvoices = await Promise.all(promises);
    const invoiceNumbers = createdInvoices.map((inv) => inv.invoiceNumber);
    const uniqueNumbers = new Set(invoiceNumbers);

    assert.equal(invoiceNumbers.length, concurrentCount);
    assert.equal(uniqueNumbers.size, concurrentCount, "All invoice numbers created concurrently must be unique");
  });

  // 12. Cross-workspace invoice and payment access is rejected
  await t.test("Scenario 12: Cross-workspace invoice and payment access is rejected", async () => {
    // User B tries to view User A's invoice
    await assert.rejects(
      async () => {
        await getInvoiceById({
          workspaceId: bakeryWorkspaceId,
          userId: userB.id,
          invoiceId: testInvoiceId,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );

    // User B tries to list User A's invoices
    await assert.rejects(
      async () => {
        await listInvoices({
          workspaceId: bakeryWorkspaceId,
          userId: userB.id,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );

    // User B tries to record payment on User A's invoice
    await assert.rejects(
      async () => {
        await recordPayment({
          workspaceId: bakeryWorkspaceId,
          userId: userB.id,
          invoiceId: testInvoiceId,
          data: { amount: 10.0 },
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  // 13. Receipt remains historically accurate after editing customer or invoice
  await t.test("Scenario 13: Receipt remains historically accurate after linked customer or invoice changes", async () => {
    const invoice = await createInvoice({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      data: {
        payerName: "Original Payer Name Inc.",
        payerEmail: "original@payer.com",
        subtotal: 1000.0,
      },
    });

    const payRes = await recordPayment({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      invoiceId: invoice.id,
      data: {
        amount: 500.0,
        status: "CONFIRMED",
        paymentMethod: "Bank Transfer",
      },
    });

    const receiptId = payRes.receipt.id;
    assert.equal(payRes.receipt.snapshot.payerName, "Original Payer Name Inc.");

    // Update invoice afterwards
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        payerName: "Completely Changed Name LLC",
        payerEmail: "changed@email.com",
      },
    });

    // Retrieve receipt and verify snapshot is frozen and unmodified
    const fetchedReceipt = await getReceiptById({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      receiptId,
    });

    assert.equal(
      fetchedReceipt.snapshot.payerName,
      "Original Payer Name Inc.",
      "Receipt snapshot must preserve historical payer name even after subsequent invoice/customer edits"
    );
    assert.equal(
      fetchedReceipt.snapshot.payerEmail,
      "original@payer.com"
    );
    assert.equal(Number(fetchedReceipt.amountReceived), 500.0);
  });

  // 14. PDF generation works and produces a readable document
  await t.test("Scenario 14: PDF generation works and produces valid vector document buffers", async () => {
    // Invoice PDF
    const invPdf = await getInvoicePdfBuffer({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      invoiceId: testInvoiceId,
    });

    assert.ok(Buffer.isBuffer(invPdf));
    assert.ok(invPdf.length > 500);
    // PDF Magic Header: %PDF-
    assert.equal(invPdf.subarray(0, 5).toString(), "%PDF-");

    // Receipt PDF
    const receipts = await listReceipts({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
    });
    assert.ok(receipts.receipts.length > 0);

    const recPdf = await getReceiptPdfBuffer({
      workspaceId: bakeryWorkspaceId,
      userId: userA.id,
      receiptId: receipts.receipts[0].id,
    });

    assert.ok(Buffer.isBuffer(recPdf));
    assert.ok(recPdf.length > 500);
    assert.equal(recPdf.subarray(0, 5).toString(), "%PDF-");
  });

  // 15. Decimal-safe calculations and overpayment rejection
  await t.test("Scenario 15: Decimal safety, rounding, and overpayment prevention", async () => {
    const inv = await createInvoice({
      workspaceId: consultingWorkspaceId,
      userId: userA.id,
      data: {
        subtotal: 100.0,
      },
    });

    // Attempting to pay more than balance (e.g. 100.01) must reject
    await assert.rejects(
      async () => {
        await recordPayment({
          workspaceId: consultingWorkspaceId,
          userId: userA.id,
          invoiceId: inv.id,
          data: {
            amount: 150.0,
            status: "CONFIRMED",
          },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /exceeds outstanding invoice balance/i);
        return true;
      }
    );

    // Negative payment rejection
    await assert.rejects(
      async () => {
        await recordPayment({
          workspaceId: consultingWorkspaceId,
          userId: userA.id,
          invoiceId: inv.id,
          data: {
            amount: -50.0,
          },
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /positive number/i);
        return true;
      }
    );
  });
});
