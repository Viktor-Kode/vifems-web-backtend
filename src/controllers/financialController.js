// ============================================================
// VifeMS — Universal Financial Document Controller
// src/controllers/financialController.js
// ============================================================

import {
  getFinancialCapabilities,
  createInvoice,
  listInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  recordPayment,
  listPayments,
  listReceipts,
  getReceiptById,
  getInvoicePdfBuffer,
  getReceiptPdfBuffer,
} from "../services/financialService.js";

export async function getCapabilitiesController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const capabilities = await getFinancialCapabilities({
      workspaceId,
      userId: req.user.id,
    });
    res.json({ success: true, capabilities });
  } catch (err) {
    next(err);
  }
}

export async function createInvoiceController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const invoice = await createInvoice({
      workspaceId,
      userId: req.user.id,
      data: req.body,
    });
    res.status(201).json({ success: true, invoice });
  } catch (err) {
    next(err);
  }
}

export async function listInvoicesController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const { page, limit, status, search } = req.query;
    const result = await listInvoices({
      workspaceId,
      userId: req.user.id,
      page,
      limit,
      status,
      search,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceController(req, res, next) {
  try {
    const { workspaceId, invoiceId } = req.params;
    const invoice = await getInvoiceById({
      workspaceId,
      userId: req.user.id,
      invoiceId,
    });
    res.json({ success: true, invoice });
  } catch (err) {
    next(err);
  }
}

export async function updateInvoiceStatusController(req, res, next) {
  try {
    const { workspaceId, invoiceId } = req.params;
    const { status, notes } = req.body;
    const invoice = await updateInvoiceStatus({
      workspaceId,
      userId: req.user.id,
      invoiceId,
      status,
      notes,
    });
    res.json({ success: true, invoice });
  } catch (err) {
    next(err);
  }
}

export async function recordPaymentController(req, res, next) {
  try {
    const { workspaceId, invoiceId } = req.params;
    const result = await recordPayment({
      workspaceId,
      userId: req.user.id,
      invoiceId,
      data: req.body,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function listPaymentsController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const { page, limit } = req.query;
    const result = await listPayments({
      workspaceId,
      userId: req.user.id,
      page,
      limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function listReceiptsController(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const { page, limit } = req.query;
    const result = await listReceipts({
      workspaceId,
      userId: req.user.id,
      page,
      limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getReceiptController(req, res, next) {
  try {
    const { workspaceId, receiptId } = req.params;
    const receipt = await getReceiptById({
      workspaceId,
      userId: req.user.id,
      receiptId,
    });
    res.json({ success: true, receipt });
  } catch (err) {
    next(err);
  }
}

export async function downloadInvoicePdfController(req, res, next) {
  try {
    const { workspaceId, invoiceId } = req.params;
    const pdfBuffer = await getInvoicePdfBuffer({
      workspaceId,
      userId: req.user.id,
      invoiceId,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice_${invoiceId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function downloadReceiptPdfController(req, res, next) {
  try {
    const { workspaceId, receiptId } = req.params;
    const pdfBuffer = await getReceiptPdfBuffer({
      workspaceId,
      userId: req.user.id,
      receiptId,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="receipt_${receiptId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}
