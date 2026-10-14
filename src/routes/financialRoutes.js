// ============================================================
// VifeMS — Universal Financial Document Routes
// src/routes/financialRoutes.js
// ============================================================

import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  getCapabilitiesController,
  createInvoiceController,
  listInvoicesController,
  getInvoiceController,
  updateInvoiceStatusController,
  recordPaymentController,
  listPaymentsController,
  listReceiptsController,
  getReceiptController,
  downloadInvoicePdfController,
  downloadReceiptPdfController,
} from "../controllers/financialController.js";

const router = Router({ mergeParams: true });

// Strict authentication on all financial routes
router.use(requireAuth);

// Capabilities detection
router.get("/capabilities", getCapabilitiesController);

// Invoices
router.get("/invoices", listInvoicesController);
router.post("/invoices", createInvoiceController);
router.get("/invoices/:invoiceId", getInvoiceController);
router.patch("/invoices/:invoiceId/status", updateInvoiceStatusController);
router.get("/invoices/:invoiceId/pdf", downloadInvoicePdfController);

// Payments & Receipts
router.post("/invoices/:invoiceId/payments", recordPaymentController);
router.get("/payments", listPaymentsController);
router.get("/receipts", listReceiptsController);
router.get("/receipts/:receiptId", getReceiptController);
router.get("/receipts/:receiptId/pdf", downloadReceiptPdfController);

export default router;
