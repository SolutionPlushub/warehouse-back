CREATE TYPE "FleetOwnership" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "TmsVehicleStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'INACTIVE');
CREATE TYPE "TmsDriverStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'OFF_DUTY', 'INACTIVE');
CREATE TYPE "TmsCargoType" AS ENUM ('CONTAINER', 'PACKAGE', 'BOTH');

CREATE TABLE "tms_vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "ownership" "FleetOwnership" NOT NULL DEFAULT 'INTERNAL',
    "carrier" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "vehicleType" TEXT NOT NULL DEFAULT 'CAMION',
    "cargoType" "TmsCargoType" NOT NULL DEFAULT 'BOTH',
    "capacityTons" DOUBLE PRECISION,
    "status" "TmsVehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentDriverId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tms_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tms_drivers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownership" "FleetOwnership" NOT NULL DEFAULT 'INTERNAL',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "cin" TEXT NOT NULL,
    "permitNo" TEXT NOT NULL,
    "permitCategory" TEXT,
    "permitExpiresAt" TIMESTAMP(3),
    "status" "TmsDriverStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedVehicleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tms_drivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tms_vehicles_tenantId_plate_key" ON "tms_vehicles"("tenantId", "plate");
CREATE INDEX "tms_vehicles_tenantId_ownership_status_idx" ON "tms_vehicles"("tenantId", "ownership", "status");
CREATE INDEX "tms_vehicles_currentDriverId_idx" ON "tms_vehicles"("currentDriverId");
CREATE UNIQUE INDEX "tms_drivers_tenantId_cin_key" ON "tms_drivers"("tenantId", "cin");
CREATE INDEX "tms_drivers_tenantId_ownership_status_idx" ON "tms_drivers"("tenantId", "ownership", "status");
CREATE INDEX "tms_drivers_assignedVehicleId_idx" ON "tms_drivers"("assignedVehicleId");

ALTER TABLE "tms_vehicles"
  ADD CONSTRAINT "tms_vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_vehicles_currentDriverId_fkey" FOREIGN KEY ("currentDriverId") REFERENCES "tms_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tms_drivers"
  ADD CONSTRAINT "tms_drivers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_drivers_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "tms_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gate_passes"
  ADD COLUMN "transportMode" "FleetOwnership" NOT NULL DEFAULT 'EXTERNAL',
  ADD COLUMN "vehicleId" TEXT,
  ADD COLUMN "driverId" TEXT;

CREATE INDEX "gate_passes_vehicleId_idx" ON "gate_passes"("vehicleId");
CREATE INDEX "gate_passes_driverId_idx" ON "gate_passes"("driverId");

ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "tms_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "gate_passes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "tms_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
