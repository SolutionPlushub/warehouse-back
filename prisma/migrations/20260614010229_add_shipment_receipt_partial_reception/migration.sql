-- AlterEnum
ALTER TYPE "ShipmentLineStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "shipment_lines" ADD COLUMN     "receiptId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "shipment_receipts" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "truckPlate" TEXT,
    "targetLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_receipts_shipmentFileId_idx" ON "shipment_receipts"("shipmentFileId");

-- CreateIndex
CREATE INDEX "shipment_lines_receiptId_idx" ON "shipment_lines"("receiptId");

-- AddForeignKey
ALTER TABLE "shipment_receipts" ADD CONSTRAINT "shipment_receipts_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "shipment_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
