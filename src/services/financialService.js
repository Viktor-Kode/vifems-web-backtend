// ============================================================
// VifeMS — Core Universal Financial Document Engine
// src/services/financialService.js
//
// Manages schema-aware invoicing, confirmed payments, immutable receipts,
// server-side decimal calculations, safe numbering under concurrency,
// idempotency protection, and strict tenant isolation.
// ============================================================

import prisma from "../config/database.js";
import { getWorkspaceById } from "./workspaceService.js";
import { detectFinancialCapabilities } from "./financialDetection.js";
import { generateInvoicePdf, generateReceiptPdf } from "./pdfService.js";

/**
 * Safely rounds numeric value to 2 decimal places to avoid floating point drift.
 */
export function roundTo2(val) {
  const num = Number(val) || 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Generates next sequential invoice number for a workspace.
 * Uses atomic transaction and pad formatting: INV-YYYY-XXXX.
 */
async function generateNextInvoiceNumber(tx, workspaceId) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const existingInvoices = await tx.invoice.findMany({
    where: {
      workspaceId,
      invoiceNumber: { startsWith: prefix },
    },
    select: { invoiceNumber: true },
  });

  let maxSeq = 0;
  for (const inv of existingInvoices) {
    const parts = inv.invoiceNumber.split("-");
    const num = parseInt(parts[2], 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${nextSeq}`;
}

/**
 * Generates next sequential receipt number for a workspace.
 * Format: REC-YYYY-XXXX.
 */
async function generateNextReceiptNumber(tx, workspaceId) {
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;

  const existingReceipts = await tx.receipt.findMany({
    where: {
      workspaceId,
      receiptNumber: { startsWith: prefix },
    },
    select: { receiptNumber: true },
  });

  let maxSeq = 0;
  for (const rec of existingReceipts) {
    const parts = rec.receiptNumber.split("-");
    const num = parseInt(parts[2], 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${nextSeq}`;
}

/**
 * Retrieves financial capabilities and detected modules for a workspace.
 */
export async function getFinancialCapabilities({ workspaceId, userId }) {
  const workspace = await getWorkspaceById(workspaceId, userId);
  return detectFinancialCapabilities(workspace);
}

/**
 * Creates an Invoice linked to actual workspace records.
 */
export async function createInvoice({ workspaceId, userId, data }) {
  const workspace = await getWorkspaceById(workspaceId, userId);
  const capabilities = detectFinancialCapabilities(workspace);

  if (!capabilities.enabled) {
    const error = new Error("This workspace does not have financial or billing operations enabled.");
    error.status = 400;
    throw error;
  }

  let payerName = data.payerName || null;
  let payerEmail = data.payerEmail || null;
  let subtotal = 0;
  let currency = data.currency || capabilities.defaultCurrency || "USD";

  // 1. Source record verification (enforce tenant isolation)
  if (data.sourceModuleSlug && data.sourceRecordId) {
    const sourceMod = workspace.modules.find(
      (m) => m.slug === data.sourceModuleSlug || m.id === data.sourceModuleSlug
    );

    if (!sourceMod) {
      const error = new Error(`Source module "${data.sourceModuleSlug}" not found in this workspace.`);
      error.status = 400;
      throw error;
    }

    const sourceRecords = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${sourceMod.tableName}" WHERE "workspace_id" = $1 AND "id" = $2`,
      workspaceId,
      data.sourceRecordId
    );

    if (!sourceRecords || sourceRecords.length === 0) {
      const error = new Error(`Source record "${data.sourceRecordId}" not found in module "${sourceMod.name}" for this workspace.`);
      error.status = 404;
      throw error;
    }

    const sourceRec = sourceRecords[0];

    // Infer amount if not explicitly passed
    if (!data.subtotal && !data.lineItems) {
      const chargeableMeta = capabilities.chargeableModules.find(
        (cm) => cm.slug === sourceMod.slug || cm.id === sourceMod.id
      );
      if (chargeableMeta?.amountField) {
        const rawAmount = sourceRec[chargeableMeta.amountField] ?? sourceRec.data?.[chargeableMeta.amountField];
        if (rawAmount !== null && rawAmount !== undefined) {
          subtotal = roundTo2(rawAmount);
        }
      }
    }

    // Infer payer from source relation if payer not specified
    if (!data.payerRecordId) {
      const chargeableMeta = capabilities.chargeableModules.find(
        (cm) => cm.slug === sourceMod.slug || cm.id === sourceMod.id
      );
      if (chargeableMeta?.payerRelation) {
        const payerField = chargeableMeta.payerRelation.fieldName;
        const linkedPayerId = sourceRec[payerField] ?? sourceRec.data?.[payerField];
        if (linkedPayerId) {
          data.payerModuleSlug = chargeableMeta.payerRelation.targetModule;
          data.payerRecordId = linkedPayerId;
        }
      } else {
        const fields = Array.isArray(sourceMod.fields) ? sourceMod.fields : [];
        const relField = fields.find((f) => (f.typeLower || f.type || "").toLowerCase() === "relation");
        if (relField) {
          const linkedId = sourceRec[relField.name] ?? sourceRec.data?.[relField.name];
          if (linkedId) {
            data.payerModuleSlug = relField.targetModule || relField.relatedEntityId;
            data.payerRecordId = linkedId;
          }
        }
      }
    }
  }

  // 2. Payer record verification (enforce tenant isolation)
  if (data.payerModuleSlug && data.payerRecordId) {
    const payerMod = workspace.modules.find(
      (m) => m.slug === data.payerModuleSlug || m.id === data.payerModuleSlug
    );

    if (payerMod) {
      const payerRecords = await prisma.$queryRawUnsafe(
        `SELECT * FROM "${payerMod.tableName}" WHERE "workspace_id" = $1 AND "id" = $2`,
        workspaceId,
        data.payerRecordId
      );

      if (payerRecords && payerRecords.length > 0) {
        const pRec = payerRecords[0];
        const pData = pRec.data || {};
        const payerMeta = capabilities.payerModules.find(
          (pm) => pm.slug === payerMod.slug || pm.id === payerMod.id
        );

        if (!payerName) {
          const fields = Array.isArray(payerMod.fields) ? payerMod.fields : [];
          const nameFieldObj =
            fields.find((f) =>
              ["full_name", "name", "company_name", "owner_name", "client_name", "customer_name", "title", "label"].includes(
                f.name.toLowerCase()
              )
            ) || fields.find((f) => (f.typeLower || f.type || "").toLowerCase() === "text");

          const fKey = nameFieldObj?.name;
          payerName =
            (fKey ? pRec[fKey] ?? pData[fKey] : null) ||
            pRec[payerMeta?.nameField] ||
            pData[payerMeta?.nameField] ||
            pRec.full_name ||
            pData.full_name ||
            pRec.company_name ||
            pData.company_name ||
            pRec.name ||
            pData.name ||
            pRec.id;
        }

        if (!payerEmail && payerMeta?.emailField) {
          payerEmail = pRec[payerMeta.emailField] || pData[payerMeta.emailField] || null;
        }
      }
    }
  }

  // 3. Line items calculation (server-side decimal arithmetic)
  let lineItems = [];
  if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
    lineItems = data.lineItems.map((li, idx) => {
      const desc = String(li.description || `Line Item ${idx + 1}`).trim();
      const qty = Math.max(1, Number(li.quantity) || 1);
      const unitPrice = roundTo2(Number(li.unitPrice) || 0);
      const amount = roundTo2(qty * unitPrice);
      return { description: desc, quantity: qty, unitPrice, amount };
    });
    subtotal = roundTo2(lineItems.reduce((acc, item) => acc + item.amount, 0));
  } else if (data.subtotal !== undefined) {
    subtotal = roundTo2(data.subtotal);
    lineItems = [
      {
        description: data.notes || "Services rendered / Charges",
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal,
      },
    ];
  }

  if (subtotal < 0) {
    const error = new Error("Invoice subtotal cannot be negative.");
    error.status = 400;
    throw error;
  }

  const discount = roundTo2(data.discount || 0);
  const tax = roundTo2(data.tax || 0);
  const totalAmount = roundTo2(Math.max(0, subtotal - discount + tax));
  const amountPaid = 0.0;
  const balanceDue = totalAmount;

  let invoice;
  let retries = 5;
  while (retries > 0) {
    try {
      invoice = await prisma.$transaction(async (tx) => {
        const invoiceNumber = await generateNextInvoiceNumber(tx, workspaceId);

        const created = await tx.invoice.create({
          data: {
            workspaceId,
            invoiceNumber,
            sourceModuleSlug: data.sourceModuleSlug || null,
            sourceRecordId: data.sourceRecordId || null,
            payerModuleSlug: data.payerModuleSlug || null,
            payerRecordId: data.payerRecordId || null,
            payerName: payerName ? String(payerName) : "Direct Customer",
            payerEmail: payerEmail ? String(payerEmail) : null,
            issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            currency: String(currency).toUpperCase(),
            subtotal,
            discount,
            tax,
            totalAmount,
            amountPaid,
            balanceDue,
            status: data.status || "Issued",
            notes: data.notes || null,
            lineItems,
            metadata: data.metadata || {},
          },
        });

        await tx.financialAuditLog.create({
          data: {
            workspaceId,
            invoiceId: created.id,
            entityType: "INVOICE",
            entityId: created.id,
            action: "CREATED",
            details: {
              invoiceNumber: created.invoiceNumber,
              totalAmount,
              currency,
              sourceRecordId: created.sourceRecordId,
            },
            userId,
          },
        });

        return created;
      });
      break;
    } catch (err) {
      if (err.code === "P2002" || err.message?.includes("Unique constraint")) {
        retries--;
        if (retries === 0) throw err;
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 40) + 10));
        continue;
      }
      throw err;
    }
  }

  return invoice;
}

/**
 * Lists invoices for a workspace with pagination, tenant isolation, and metrics.
 */
export async function listInvoices({
  workspaceId,
  userId,
  page = 1,
  limit = 50,
  status,
  search,
}) {
  await getWorkspaceById(workspaceId, userId);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const where = {
    workspaceId,
  };

  if (status) {
    where.status = status;
  }

  if (search && typeof search === "string" && search.trim()) {
    const q = search.trim();
    where.OR = [
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { payerName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [invoices, total, stats] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
      include: {
        payments: {
          select: {
            id: true,
            amount: true,
            status: true,
            paymentMethod: true,
            paymentDate: true,
          },
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            amountReceived: true,
            issuedAt: true,
          },
        },
      },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({
      where: { workspaceId },
      _sum: {
        totalAmount: true,
        amountPaid: true,
        balanceDue: true,
      },
      _count: { id: true },
    }),
  ]);

  return {
    invoices,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
    metrics: {
      totalInvoices: stats._count.id || 0,
      totalInvoiced: roundTo2(Number(stats._sum.totalAmount) || 0),
      totalPaid: roundTo2(Number(stats._sum.amountPaid) || 0),
      totalOutstanding: roundTo2(Number(stats._sum.balanceDue) || 0),
    },
  };
}

/**
 * Retrieves a single invoice by ID with payments, receipts, and audit trail.
 */
export async function getInvoiceById({ workspaceId, userId, invoiceId }) {
  await getWorkspaceById(workspaceId, userId);

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      workspaceId,
    },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
      },
      receipts: {
        orderBy: { issuedAt: "desc" },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!invoice) {
    const error = new Error("Invoice not found in this workspace.");
    error.status = 404;
    throw error;
  }

  return invoice;
}

/**
 * Updates an invoice status (e.g. Cancelled). Prevents marking as Paid if balance remains.
 */
export async function updateInvoiceStatus({ workspaceId, userId, invoiceId, status, notes }) {
  await getWorkspaceById(workspaceId, userId);

  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId },
    include: { payments: true },
  });

  if (!existing) {
    const error = new Error("Invoice not found.");
    error.status = 404;
    throw error;
  }

  if (status === "Paid" && Number(existing.balanceDue) > 0) {
    const error = new Error(
      `Cannot mark invoice as Paid while an outstanding balance of ${existing.currency} ${existing.balanceDue} remains. Record a payment to settle the balance.`
    );
    error.status = 400;
    throw error;
  }

  if (status === "Cancelled") {
    const confirmedCount = existing.payments.filter((p) => p.status === "CONFIRMED").length;
    if (confirmedCount > 0) {
      const error = new Error("Cannot cancel an invoice with confirmed payments. An adjustment or refund must be recorded.");
      error.status = 400;
      throw error;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status,
        notes: notes !== undefined ? notes : existing.notes,
      },
    });

    await tx.financialAuditLog.create({
      data: {
        workspaceId,
        invoiceId,
        entityType: "INVOICE",
        entityId: invoiceId,
        action: "STATUS_CHANGED",
        details: { oldStatus: existing.status, newStatus: status, notes },
        userId,
      },
    });

    return inv;
  });

  return updated;
}

/**
 * Records a payment against an invoice with idempotency, multi-payment tracking,
 * server-side balance derivation, and immutable receipt creation on confirmation.
 */
export async function recordPayment({ workspaceId, userId, invoiceId, data }) {
  const workspace = await getWorkspaceById(workspaceId, userId);

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId },
  });

  if (!invoice) {
    const error = new Error("Invoice not found in this workspace.");
    error.status = 404;
    throw error;
  }

  if (invoice.status === "Cancelled") {
    const error = new Error("Cannot record payments on a cancelled invoice.");
    error.status = 400;
    throw error;
  }

  // Idempotency check: if payment with same key was already processed in this workspace
  if (data.idempotencyKey) {
    const existingPayment = await prisma.payment.findFirst({
      where: {
        workspaceId,
        idempotencyKey: data.idempotencyKey,
      },
      include: { receipt: true },
    });

    if (existingPayment) {
      const currentInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      return {
        payment: existingPayment,
        receipt: existingPayment.receipt,
        invoice: currentInvoice,
        alreadyProcessed: true,
      };
    }
  }

  const rawAmount = Number(data.amount);
  if (isNaN(rawAmount) || rawAmount <= 0) {
    const error = new Error("Payment amount must be a positive number greater than 0.");
    error.status = 400;
    throw error;
  }
  const paymentAmount = roundTo2(rawAmount);

  // Validate currency
  const currency = String(data.currency || invoice.currency).toUpperCase();
  if (currency !== invoice.currency) {
    const error = new Error(`Payment currency "${currency}" does not match invoice currency "${invoice.currency}".`);
    error.status = 400;
    throw error;
  }

  // Check overpayment
  const currentBalance = roundTo2(Number(invoice.balanceDue));
  if (paymentAmount > currentBalance && !data.allowOverpayment) {
    const error = new Error(
      `Payment amount (${currency} ${paymentAmount}) exceeds outstanding invoice balance (${currency} ${currentBalance}).`
    );
    error.status = 400;
    throw error;
  }

  const paymentStatus = (data.status || "CONFIRMED").toUpperCase();
  const paymentMethod = data.paymentMethod || "Bank Transfer";

  // Execute in database transaction for strict financial integrity
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create Payment record
    const payment = await tx.payment.create({
      data: {
        workspaceId,
        invoiceId,
        amount: paymentAmount,
        currency,
        paymentMethod,
        status: paymentStatus,
        transactionRef: data.transactionRef || null,
        idempotencyKey: data.idempotencyKey || null,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
        notes: data.notes || null,
        metadata: data.metadata || {},
      },
    });

    let receipt = null;
    let updatedInvoice = invoice;

    // 2. Only confirmed payments update funds and produce receipts
    if (paymentStatus === "CONFIRMED") {
      const prevPaid = roundTo2(Number(invoice.amountPaid));
      const newPaid = roundTo2(prevPaid + paymentAmount);
      const newBalance = roundTo2(Math.max(0, Number(invoice.totalAmount) - newPaid));
      const newInvoiceStatus = newBalance <= 0 ? "Paid" : "Partially Paid";

      updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: newPaid,
          balanceDue: newBalance,
          status: newInvoiceStatus,
        },
      });

      // Generate unique receipt number
      const receiptNumber = await generateNextReceiptNumber(tx, workspaceId);

      // Construct immutable document snapshot
      const snapshot = {
        workspaceId,
        workspaceName: workspace.name,
        receiptNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        sourceModuleSlug: invoice.sourceModuleSlug,
        sourceRecordId: invoice.sourceRecordId,
        payerName: invoice.payerName,
        payerEmail: invoice.payerEmail,
        currency,
        totalAmount: Number(invoice.totalAmount),
        previousPaidAmount: prevPaid,
        amountReceived: paymentAmount,
        remainingBalance: newBalance,
        paymentMethod,
        transactionRef: payment.transactionRef,
        paymentDate: payment.paymentDate,
        issuedAt: new Date(),
      };

      receipt = await tx.receipt.create({
        data: {
          workspaceId,
          receiptNumber,
          invoiceId,
          paymentId: payment.id,
          amountReceived: paymentAmount,
          currency,
          paymentDate: payment.paymentDate,
          paymentMethod,
          transactionRef: payment.transactionRef,
          previousPaidAmount: prevPaid,
          remainingBalance: newBalance,
          snapshot,
        },
      });

      await tx.financialAuditLog.create({
        data: {
          workspaceId,
          invoiceId,
          paymentId: payment.id,
          receiptId: receipt.id,
          entityType: "PAYMENT",
          entityId: payment.id,
          action: "PAYMENT_CONFIRMED",
          details: {
            amount: paymentAmount,
            receiptNumber: receipt.receiptNumber,
            remainingBalance: newBalance,
          },
          userId,
        },
      });
    } else {
      // Pending, Failed, or Cancelled payment
      await tx.financialAuditLog.create({
        data: {
          workspaceId,
          invoiceId,
          paymentId: payment.id,
          entityType: "PAYMENT",
          entityId: payment.id,
          action: "PAYMENT_RECORDED",
          details: {
            amount: paymentAmount,
            status: paymentStatus,
            notice: "Unconfirmed payment. Invoice balance unchanged. No receipt generated.",
          },
          userId,
        },
      });
    }

    return { payment, receipt, invoice: updatedInvoice };
  });

  return result;
}

/**
 * Lists confirmed & pending payments for a workspace.
 */
export async function listPayments({ workspaceId, userId, page = 1, limit = 50 }) {
  await getWorkspaceById(workspaceId, userId);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: { workspaceId },
      orderBy: { paymentDate: "desc" },
      skip,
      take: limitNum,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            payerName: true,
            totalAmount: true,
            balanceDue: true,
          },
        },
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
            issuedAt: true,
          },
        },
      },
    }),
    prisma.payment.count({ where: { workspaceId } }),
  ]);

  return {
    payments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Lists receipts for a workspace.
 */
export async function listReceipts({ workspaceId, userId, page = 1, limit = 50 }) {
  await getWorkspaceById(workspaceId, userId);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [receipts, total] = await Promise.all([
    prisma.receipt.findMany({
      where: { workspaceId },
      orderBy: { issuedAt: "desc" },
      skip,
      take: limitNum,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            payerName: true,
          },
        },
        payment: {
          select: {
            id: true,
            paymentMethod: true,
            transactionRef: true,
          },
        },
      },
    }),
    prisma.receipt.count({ where: { workspaceId } }),
  ]);

  return {
    receipts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Retrieves a single receipt by ID with snapshot and tenant isolation.
 */
export async function getReceiptById({ workspaceId, userId, receiptId }) {
  await getWorkspaceById(workspaceId, userId);

  const receipt = await prisma.receipt.findFirst({
    where: {
      id: receiptId,
      workspaceId,
    },
    include: {
      invoice: true,
      payment: true,
    },
  });

  if (!receipt) {
    const error = new Error("Receipt not found in this workspace.");
    error.status = 404;
    throw error;
  }

  return receipt;
}

/**
 * Generates vector PDF buffer for an Invoice.
 */
export async function getInvoicePdfBuffer({ workspaceId, userId, invoiceId }) {
  const workspace = await getWorkspaceById(workspaceId, userId);
  const invoice = await getInvoiceById({ workspaceId, userId, invoiceId });
  return generateInvoicePdf({ invoice, workspace });
}

/**
 * Generates vector PDF buffer for a Receipt.
 */
export async function getReceiptPdfBuffer({ workspaceId, userId, receiptId }) {
  const workspace = await getWorkspaceById(workspaceId, userId);
  const receipt = await getReceiptById({ workspaceId, userId, receiptId });
  return generateReceiptPdf({ receipt, workspace });
}
