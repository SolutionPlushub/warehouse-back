-- CreateTable
CREATE TABLE IF NOT EXISTS "shipment_file_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "field" TEXT,
    "from" TEXT,
    "to" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_file_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shipment_file_audit_logs_shipmentFileId_createdAt_idx"
  ON "shipment_file_audit_logs"("shipmentFileId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shipment_file_audit_logs_tenantId_createdAt_idx"
  ON "shipment_file_audit_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "shipment_file_audit_logs"
  ADD CONSTRAINT "shipment_file_audit_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipment_file_audit_logs"
  ADD CONSTRAINT "shipment_file_audit_logs_shipmentFileId_fkey"
  FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipment_file_audit_logs"
  ADD CONSTRAINT "shipment_file_audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
