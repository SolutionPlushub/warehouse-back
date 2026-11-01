/*
  Warnings:

  - You are about to drop the column `yardId` on the `shipment_files` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `shipment_lines` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "shipment_files" DROP CONSTRAINT "shipment_files_yardId_fkey";

-- DropIndex
DROP INDEX "shipment_files_yardId_idx";

-- AlterTable
ALTER TABLE "shipment_files" DROP COLUMN "yardId",
ADD COLUMN     "defaultYardId" TEXT;

-- AlterTable
ALTER TABLE "shipment_lines" DROP COLUMN "locationId",
ADD COLUMN     "yardId" TEXT,
ADD COLUMN     "zoneId" TEXT;

-- CreateIndex
CREATE INDEX "shipment_files_defaultYardId_idx" ON "shipment_files"("defaultYardId");

-- CreateIndex
CREATE INDEX "shipment_lines_yardId_idx" ON "shipment_lines"("yardId");

-- CreateIndex
CREATE INDEX "shipment_lines_zoneId_idx" ON "shipment_lines"("zoneId");

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_defaultYardId_fkey" FOREIGN KEY ("defaultYardId") REFERENCES "yards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "storage_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
