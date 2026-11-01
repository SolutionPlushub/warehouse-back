-- CreateTable
CREATE TABLE "shipment_file_documents" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attached" BOOLEAN NOT NULL DEFAULT false,
    "attachedAt" TIMESTAMP(3),
    "attachedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_file_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_file_documents_tenantId_idx" ON "shipment_file_documents"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_file_documents_shipmentFileId_name_key" ON "shipment_file_documents"("shipmentFileId", "name");

-- AddForeignKey
ALTER TABLE "shipment_file_documents" ADD CONSTRAINT "shipment_file_documents_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_documents" ADD CONSTRAINT "shipment_file_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_documents" ADD CONSTRAINT "shipment_file_documents_attachedById_fkey" FOREIGN KEY ("attachedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
