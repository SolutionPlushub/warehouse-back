-- CreateEnum
CREATE TYPE "GateTruckVisitStatus" AS ENUM ('ON_SITE', 'EXITED');

-- CreateEnum
CREATE TYPE "TruckLoadStatus" AS ENUM ('LOADED', 'EXITED', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "gate_passes" ADD COLUMN     "truckVisitId" TEXT;

-- CreateTable
CREATE TABLE "gate_truck_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "plateNorm" TEXT NOT NULL,
    "carrier" TEXT,
    "driverName" TEXT,
    "driverCin" TEXT,
    "permitNo" TEXT,
    "tmsVehicleId" TEXT,
    "status" "GateTruckVisitStatus" NOT NULL DEFAULT 'ON_SITE',
    "gateInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateOutAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_truck_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_loads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "plateNorm" TEXT NOT NULL,
    "carrier" TEXT,
    "driverName" TEXT,
    "driverCin" TEXT,
    "permitNo" TEXT,
    "destination" TEXT,
    "deliveryRef" TEXT,
    "status" "TruckLoadStatus" NOT NULL DEFAULT 'LOADED',
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateOutAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "truckVisitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "truck_loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_load_lines" (
    "id" TEXT NOT NULL,
    "truckLoadId" TEXT NOT NULL,
    "operationLineId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "yardContainerId" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truck_load_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_truck_visits_tenantId_plateNorm_idx" ON "gate_truck_visits"("tenantId", "plateNorm");

-- CreateIndex
CREATE INDEX "gate_truck_visits_tenantId_status_idx" ON "gate_truck_visits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "truck_loads_tenantId_status_idx" ON "truck_loads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "truck_loads_tenantId_plateNorm_idx" ON "truck_loads"("tenantId", "plateNorm");

-- CreateIndex
CREATE INDEX "truck_load_lines_truckLoadId_idx" ON "truck_load_lines"("truckLoadId");

-- CreateIndex
CREATE INDEX "truck_load_lines_operationLineId_idx" ON "truck_load_lines"("operationLineId");

-- CreateIndex
CREATE INDEX "truck_load_lines_shipmentFileId_idx" ON "truck_load_lines"("shipmentFileId");

-- CreateIndex
CREATE INDEX "gate_passes_truckVisitId_idx" ON "gate_passes"("truckVisitId");

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_truckVisitId_fkey" FOREIGN KEY ("truckVisitId") REFERENCES "gate_truck_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_truck_visits" ADD CONSTRAINT "gate_truck_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_truck_visits" ADD CONSTRAINT "gate_truck_visits_tmsVehicleId_fkey" FOREIGN KEY ("tmsVehicleId") REFERENCES "tms_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_loads" ADD CONSTRAINT "truck_loads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_loads" ADD CONSTRAINT "truck_loads_truckVisitId_fkey" FOREIGN KEY ("truckVisitId") REFERENCES "gate_truck_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_load_lines" ADD CONSTRAINT "truck_load_lines_truckLoadId_fkey" FOREIGN KEY ("truckLoadId") REFERENCES "truck_loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_load_lines" ADD CONSTRAINT "truck_load_lines_operationLineId_fkey" FOREIGN KEY ("operationLineId") REFERENCES "operation_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Séparation Gate / TMS : les camions de transporteurs tiers créés
-- automatiquement dans la flotte TMS par les passages Gate restaient
-- « En mission » (IN_USE) indéfiniment. Ils ne sont plus suivis par le TMS :
-- remis à disposition, ainsi que leurs chauffeurs externes, sauf s'ils sont
-- engagés sur une tournée en cours.
UPDATE "tms_vehicles" AS v
SET "status" = 'AVAILABLE', "currentDriverId" = NULL
WHERE v."ownership" = 'EXTERNAL'
  AND v."status" = 'IN_USE'
  AND NOT EXISTS (
    SELECT 1 FROM "tms_trips" t
    WHERE t."vehicleId" = v."id" AND t."status" IN ('PLANNED', 'IN_PROGRESS')
  );

UPDATE "tms_drivers" AS d
SET "status" = 'AVAILABLE', "assignedVehicleId" = NULL
WHERE d."ownership" = 'EXTERNAL'
  AND d."status" = 'IN_USE'
  AND NOT EXISTS (
    SELECT 1 FROM "tms_trips" t
    WHERE t."driverId" = d."id" AND t."status" IN ('PLANNED', 'IN_PROGRESS')
  );
