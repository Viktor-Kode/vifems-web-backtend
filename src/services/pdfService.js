// ============================================================
// VifeMS — Vector PDF Document Generation Service
// src/services/pdfService.js
//
// Generates professional, vector-sharp PDF documents for
// Invoices and Receipts using PDFKit.
// ============================================================

import PDFDocument from "pdfkit";

/**
 * Formats a numeric value into a clean currency string.
 */
function formatMoney(amount, currency = "USD") {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

/**
 * Formats date into readable string.
 */
function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

/**
 * Generates a PDF buffer for an Invoice.
 */
export async function generateInvoicePdf({ invoice, workspace }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: {
          Title: `Invoice ${invoice.invoiceNumber}`,
          Author: workspace?.name || "VifeMS",
          Subject: "Business Invoice",
        },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const primaryColor = "#1e3a8a"; // Deep corporate blue
      const neutralDark = "#0f172a";
      const neutralLight = "#64748b";
      const borderColor = "#e2e8f0";

      // ── HEADER ──
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(workspace?.name || "VifeMS Business", 50, 50);

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text("Powered by VifeMS Workspace Engine", 50, 78);

      // Invoice Document Title on right
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("INVOICE", 400, 50, { align: "right" });

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(invoice.invoiceNumber, 400, 75, { align: "right" });

      // Status Badge
      const statusText = (invoice.status || "DRAFT").toUpperCase();
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(invoice.status === "Paid" ? "#16a34a" : invoice.status === "Cancelled" ? "#dc2626" : "#2563eb")
        .text(`Status: ${statusText}`, 400, 92, { align: "right" });

      // Horizontal Divider
      doc
        .strokeColor(borderColor)
        .lineWidth(1)
        .moveTo(50, 115)
        .lineTo(545, 115)
        .stroke();

      // ── METADATA & BILL TO ──
      const metaY = 130;
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("BILL TO:", 50, metaY);

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(invoice.payerName || "Valued Client", 50, metaY + 16);

      if (invoice.payerEmail) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(neutralLight)
          .text(invoice.payerEmail, 50, metaY + 32);
      }

      if (invoice.sourceRecordId) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(neutralLight)
          .text(`Ref Record: ${invoice.sourceRecordId}`, 50, metaY + 46);
      }

      // Dates Column on right
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Issue Date:", 360, metaY)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text(formatDate(invoice.issueDate), 440, metaY, { align: "right" });

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Due Date:", 360, metaY + 18)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text(formatDate(invoice.dueDate), 440, metaY + 18, { align: "right" });

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Currency:", 360, metaY + 36)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text(invoice.currency || "USD", 440, metaY + 36, { align: "right" });

      // ── LINE ITEMS TABLE ──
      const tableTop = 210;
      doc
        .rect(50, tableTop, 495, 24)
        .fill("#f8fafc");

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("DESCRIPTION", 60, tableTop + 7)
        .text("QTY", 330, tableTop + 7, { width: 40, align: "center" })
        .text("UNIT PRICE", 380, tableTop + 7, { width: 70, align: "right" })
        .text("AMOUNT", 460, tableTop + 7, { width: 75, align: "right" });

      let currentY = tableTop + 30;
      const items = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
        ? invoice.lineItems
        : [{ description: "Services rendered / order charges", quantity: 1, unitPrice: invoice.subtotal, amount: invoice.subtotal }];

      doc.font("Helvetica").fontSize(9);

      for (const item of items) {
        const itemDesc = item.description || "Charge item";
        const qty = item.quantity || 1;
        const price = formatMoney(item.unitPrice, invoice.currency);
        const amount = formatMoney(item.amount, invoice.currency);

        doc
          .fillColor(neutralDark)
          .text(itemDesc, 60, currentY, { width: 260 })
          .fillColor(neutralLight)
          .text(String(qty), 330, currentY, { width: 40, align: "center" })
          .text(price, 380, currentY, { width: 70, align: "right" })
          .fillColor(neutralDark)
          .text(amount, 460, currentY, { width: 75, align: "right" });

        currentY += 22;
        doc
          .strokeColor(borderColor)
          .lineWidth(0.5)
          .moveTo(50, currentY - 5)
          .lineTo(545, currentY - 5)
          .stroke();
      }

      // ── TOTALS SECTION ──
      const totalsY = Math.max(currentY + 15, 380);
      const summaryX = 350;

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text("Subtotal:", summaryX, totalsY)
        .fillColor(neutralDark)
        .text(formatMoney(invoice.subtotal, invoice.currency), 440, totalsY, { align: "right" });

      if (Number(invoice.discount) > 0) {
        doc
          .fillColor(neutralLight)
          .text("Discount:", summaryX, totalsY + 16)
          .fillColor("#16a34a")
          .text(`-${formatMoney(invoice.discount, invoice.currency)}`, 440, totalsY + 16, { align: "right" });
      }

      if (Number(invoice.tax) > 0) {
        doc
          .fillColor(neutralLight)
          .text("Tax:", summaryX, totalsY + 32)
          .fillColor(neutralDark)
          .text(formatMoney(invoice.tax, invoice.currency), 440, totalsY + 32, { align: "right" });
      }

      // Total Due Highlight
      const totalYOffset = totalsY + 50;
      doc
        .rect(summaryX - 10, totalYOffset - 4, 205, 26)
        .fill("#f1f5f9");

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Total Amount:", summaryX, totalYOffset + 4)
        .fillColor(primaryColor)
        .text(formatMoney(invoice.totalAmount, invoice.currency), 440, totalYOffset + 4, { align: "right" });

      // Amount Paid & Balance Due
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text("Amount Paid:", summaryX, totalYOffset + 32)
        .fillColor("#16a34a")
        .text(formatMoney(invoice.amountPaid, invoice.currency), 440, totalYOffset + 32, { align: "right" });

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(Number(invoice.balanceDue) <= 0 ? "#16a34a" : "#dc2626")
        .text("Balance Due:", summaryX, totalYOffset + 50)
        .text(formatMoney(invoice.balanceDue, invoice.currency), 440, totalYOffset + 50, { align: "right" });

      // Notes / Footer
      if (invoice.notes) {
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor(neutralDark)
          .text("Notes & Payment Instructions:", 50, totalsY)
          .font("Helvetica")
          .fillColor(neutralLight)
          .text(invoice.notes, 50, totalsY + 14, { width: 260 });
      }

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#94a3b8")
        .text(
          `Generated electronically on ${new Date().toUTCString()} • Tenant ID: ${workspace?.id || "N/A"}`,
          50,
          750,
          { align: "center", width: 495 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates a PDF buffer for a Receipt.
 */
export async function generateReceiptPdf({ receipt, workspace }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: {
          Title: `Receipt ${receipt.receiptNumber}`,
          Author: workspace?.name || "VifeMS",
          Subject: "Official Payment Receipt",
        },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const primaryColor = "#0f766e"; // Deep emerald / teal for receipts
      const neutralDark = "#0f172a";
      const neutralLight = "#64748b";
      const borderColor = "#e2e8f0";

      const snapshot = receipt.snapshot || {};

      // ── HEADER ──
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(workspace?.name || snapshot.workspaceName || "VifeMS Business", 50, 50);

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text("Official Payment Receipt", 50, 78);

      // Receipt Title on right
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("RECEIPT", 400, 50, { align: "right" });

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(receipt.receiptNumber, 400, 75, { align: "right" });

      // Confirmation Stamp
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor("#16a34a")
        .text("PAYMENT CONFIRMED", 400, 92, { align: "right" });

      // Horizontal Divider
      doc
        .strokeColor(borderColor)
        .lineWidth(1)
        .moveTo(50, 115)
        .lineTo(545, 115)
        .stroke();

      // ── AMOUNT RECEIVED CARD ──
      doc
        .rect(50, 130, 495, 70)
        .fill("#f0fdf4");

      doc
        .strokeColor("#86efac")
        .lineWidth(1)
        .rect(50, 130, 495, 70)
        .stroke();

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor("#166534")
        .text("AMOUNT RECEIVED", 70, 145);

      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .fillColor("#15803d")
        .text(formatMoney(receipt.amountReceived, receipt.currency), 70, 162);

      // Payment Date on right side of card
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#166534")
        .text("Payment Date:", 360, 145)
        .font("Helvetica-Bold")
        .text(formatDate(receipt.paymentDate), 430, 145, { align: "right" })
        .font("Helvetica")
        .text("Payment Method:", 360, 162)
        .font("Helvetica-Bold")
        .text(receipt.paymentMethod || "Direct", 430, 162, { align: "right" });

      if (receipt.transactionRef) {
        doc
          .font("Helvetica")
          .text("Ref #:", 360, 178)
          .font("Helvetica-Bold")
          .text(receipt.transactionRef, 400, 178, { align: "right" });
      }

      // ── PAYER & INVOICE DETAILS ──
      const detY = 220;
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("RECEIVED FROM:", 50, detY);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(snapshot.payerName || "Valued Customer", 50, detY + 16);

      if (snapshot.payerEmail) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(neutralLight)
          .text(snapshot.payerEmail, 50, detY + 34);
      }

      // Associated Invoice details on right
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("INVOICE REFERENCE:", 320, detY);

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(neutralDark)
        .text("Invoice Number:", 320, detY + 16)
        .font("Helvetica-Bold")
        .fillColor(primaryColor)
        .text(snapshot.invoiceNumber || "—", 440, detY + 16, { align: "right" });

      if (snapshot.sourceRecordId) {
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(neutralLight)
          .text("Source Record:", 320, detY + 32)
          .text(snapshot.sourceRecordId, 440, detY + 32, { align: "right" });
      }

      // Divider
      doc
        .strokeColor(borderColor)
        .lineWidth(1)
        .moveTo(50, detY + 60)
        .lineTo(545, detY + 60)
        .stroke();

      // ── FINANCIAL ACCOUNTING BREAKDOWN ──
      const accY = detY + 80;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Payment & Balance Summary", 50, accY);

      const tableTop = accY + 20;
      doc
        .rect(50, tableTop, 495, 24)
        .fill("#f8fafc");

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("ACCOUNTING STAGE", 65, tableTop + 7)
        .text("AMOUNT", 460, tableTop + 7, { width: 75, align: "right" });

      let rowY = tableTop + 24;

      const rows = [
        { label: "Total Invoice Amount", val: formatMoney(snapshot.totalAmount, receipt.currency), bold: false },
        { label: "Amount Paid Prior to this Transaction", val: formatMoney(receipt.previousPaidAmount, receipt.currency), bold: false },
        { label: "Payment Confirmed (This Receipt)", val: `+${formatMoney(receipt.amountReceived, receipt.currency)}`, bold: true, color: "#16a34a" },
        { label: "Remaining Balance Due", val: formatMoney(receipt.remainingBalance, receipt.currency), bold: true, color: Number(receipt.remainingBalance) <= 0 ? "#16a34a" : "#dc2626" },
      ];

      for (const r of rows) {
        doc
          .rect(50, rowY, 495, 26)
          .strokeColor(borderColor)
          .lineWidth(0.5)
          .stroke();

        doc
          .fontSize(9)
          .font(r.bold ? "Helvetica-Bold" : "Helvetica")
          .fillColor(neutralDark)
          .text(r.label, 65, rowY + 8)
          .fillColor(r.color || neutralDark)
          .text(r.val, 440, rowY + 8, { width: 95, align: "right" });

        rowY += 26;
      }

      // Security / Verification Seal Notice
      const sealY = rowY + 40;
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(neutralDark)
        .text("Proof of Payment Verification", 50, sealY)
        .fontSize(8.5)
        .font("Helvetica")
        .fillColor(neutralLight)
        .text(
          "This receipt is a tamper-evident system snapshot confirming funds received. It constitutes an irrevocable record of payment as of the issue date.",
          50,
          sealY + 14,
          { width: 495 }
        );

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#94a3b8")
        .text(
          `Document ID: ${receipt.id} • Issued At: ${new Date(receipt.issuedAt).toUTCString()} • VifeMS Financial Engine`,
          50,
          750,
          { align: "center", width: 495 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
