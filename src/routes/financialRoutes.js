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

/**
 * @openapi
 * /api/workspaces/{workspaceId}/financial/capabilities:
 *   get:
 *     tags: [Financial documents]
 *     summary: Detect financial capabilities
 *     description: Requires an authenticated user who owns the workspace.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: workspaceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Capability flags returned. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/invoices:
 *   get:
 *     tags: [Financial documents]
 *     summary: List workspace invoices
 *     description: Supports page, limit, status, and search query parameters. Requires workspace ownership.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated invoice list. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 *   post:
 *     tags: [Financial documents]
 *     summary: Create an invoice
 *     description: Creates an invoice from the supplied data after server-side validation. Requires workspace ownership.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, description: Invoice fields are validated by the financial service; see its implementation for accepted fields. }
 *     responses:
 *       201: { description: Invoice created. }
 *       400: { description: Invalid invoice data. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/invoices/{invoiceId}:
 *   get:
 *     tags: [Financial documents]
 *     summary: Get an invoice
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: invoiceId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Invoice details. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Invoice not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/invoices/{invoiceId}/status:
 *   patch:
 *     tags: [Financial documents]
 *     summary: Update invoice status
 *     description: Status transitions are checked by the financial service; a balance-due invoice cannot be marked Paid.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: invoiceId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, description: Requested status; service validates transition. }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Updated invoice. }
 *       400: { description: Invalid or disallowed status transition. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Invoice not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/invoices/{invoiceId}/payments:
 *   post:
 *     tags: [Financial documents]
 *     summary: Record a payment manually
 *     description: Records user-supplied payment information. CONFIRMED is the service default and does not indicate processor verification.
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: invoiceId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, description: Payment data accepted and validated by the financial service. }
 *     responses:
 *       201: { description: Payment recorded; a receipt is returned when the payment is confirmed. }
 *       400: { description: Invalid payment or amount exceeds the invoice balance. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Invoice not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/payments:
 *   get:
 *     tags: [Financial documents]
 *     summary: List workspace payments
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: Paginated payment list. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/receipts:
 *   get:
 *     tags: [Financial documents]
 *     summary: List workspace receipts
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: Paginated receipt list. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/receipts/{receiptId}:
 *   get:
 *     tags: [Financial documents]
 *     summary: Get a receipt
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: receiptId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Receipt details. }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Receipt not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/invoices/{invoiceId}/pdf:
 *   get:
 *     tags: [Financial documents]
 *     summary: Download invoice PDF
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: invoiceId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Invoice PDF; not proof of payment.
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Invoice not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /api/workspaces/{workspaceId}/financial/receipts/{receiptId}/pdf:
 *   get:
 *     tags: [Financial documents]
 *     summary: Download receipt PDF
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: workspaceId, required: true, schema: { type: string } }
 *       - { in: path, name: receiptId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Receipt PDF.
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { description: Authentication required. }
 *       403: { description: User does not own the workspace. }
 *       404: { description: Receipt not found in this workspace. }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */

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
