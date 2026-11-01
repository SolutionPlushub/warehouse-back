-- Cycle de la facture métier d'un dossier (distinct de SubscriptionInvoice,
-- facturation SaaS de la plateforme). Miroir de
-- d.finance.{invoiceStatus,invoiceNo,paid,dexValidation,dexRejection}
-- côté frontend (dos-store.js).
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID');

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" INTEGER,
    "vat" INTEGER,
    "stampDuty" INTEGER,
    "total" INTEGER,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "dexValidatedAt" TIMESTAMP(3),
    "dexValidatedById" TEXT,
    "dexRejectedAt" TIMESTAMP(3),
    "dexRejectedById" TEXT,
    "dexRejectionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_shipmentFileId_key" ON "invoices"("shipmentFileId");
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
