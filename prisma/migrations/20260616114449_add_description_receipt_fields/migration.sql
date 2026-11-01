-- AlterTable: ShipmentLine — ajouter description
ALTER TABLE "shipment_lines" ADD COLUMN "description" TEXT;

-- AlterTable: ShipmentReceipt — ajouter transportDocNumber et comments
ALTER TABLE "shipment_receipts" ADD COLUMN "transportDocNumber" TEXT;
ALTER TABLE "shipment_receipts" ADD COLUMN "comments" TEXT;
