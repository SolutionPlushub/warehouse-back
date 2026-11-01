-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "expectedQuantity" INTEGER;

-- AlterTable
ALTER TABLE "shipment_lines" ADD COLUMN     "countedAt" TIMESTAMP(3),
ADD COLUMN     "countedQuantity" INTEGER;
