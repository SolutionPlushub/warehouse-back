-- CreateEnum
CREATE TYPE "GateTruckPurpose" AS ENUM ('CARRIER', 'RECEIVER');

-- AlterTable
ALTER TABLE "gate_truck_visits" ADD COLUMN     "purpose" "GateTruckPurpose",
ADD COLUMN     "shipmentFileId" TEXT;

-- CreateIndex
CREATE INDEX "gate_truck_visits_shipmentFileId_idx" ON "gate_truck_visits"("shipmentFileId");

-- AddForeignKey
ALTER TABLE "gate_truck_visits" ADD CONSTRAINT "gate_truck_visits_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

