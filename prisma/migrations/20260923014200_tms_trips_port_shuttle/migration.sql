CREATE TYPE "TmsTripType" AS ENUM ('DISTRIBUTION', 'PORT_SHUTTLE');
CREATE TYPE "TmsTripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');
CREATE TYPE "TmsLegKind" AS ENUM ('EXPORT', 'IMPORT', 'EMPTY', 'NONE');
CREATE TYPE "TmsPortWindowStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');

CREATE TABLE "tms_port_windows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "kind" "TmsLegKind" NOT NULL,
    "vessel" TEXT,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,
    "status" "TmsPortWindowStatus" NOT NULL DEFAULT 'PLANNED',
    "externalId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tms_port_windows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tms_trips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TmsTripType" NOT NULL DEFAULT 'DISTRIBUTION',
    "status" "TmsTripStatus" NOT NULL DEFAULT 'PLANNED',
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "shipmentFileId" TEXT,
    "clientName" TEXT,
    "destination" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "estimatedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "distanceKm" DOUBLE PRECISION,
    "stops" INTEGER NOT NULL DEFAULT 1,
    "operationLineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cargoLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "podSignedAt" TIMESTAMP(3),
    "podRecipient" TEXT,
    "fuelTheoL" DOUBLE PRECISION,
    "fuelRealL" DOUBLE PRECISION,
    "outboundKind" "TmsLegKind" NOT NULL DEFAULT 'NONE',
    "outboundContainer" TEXT,
    "outboundWindowId" TEXT,
    "returnKind" "TmsLegKind" NOT NULL DEFAULT 'NONE',
    "returnContainer" TEXT,
    "returnWindowId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tms_trips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tms_port_windows_tenantId_code_key" ON "tms_port_windows"("tenantId", "code");
CREATE INDEX "tms_port_windows_tenantId_slotStart_idx" ON "tms_port_windows"("tenantId", "slotStart");
CREATE INDEX "tms_port_windows_status_idx" ON "tms_port_windows"("status");
CREATE UNIQUE INDEX "tms_trips_tenantId_code_key" ON "tms_trips"("tenantId", "code");
CREATE INDEX "tms_trips_tenantId_type_status_idx" ON "tms_trips"("tenantId", "type", "status");
CREATE INDEX "tms_trips_vehicleId_idx" ON "tms_trips"("vehicleId");
CREATE INDEX "tms_trips_driverId_idx" ON "tms_trips"("driverId");
CREATE INDEX "tms_trips_shipmentFileId_idx" ON "tms_trips"("shipmentFileId");
CREATE INDEX "tms_trips_scheduledStart_idx" ON "tms_trips"("scheduledStart");

ALTER TABLE "tms_port_windows"
  ADD CONSTRAINT "tms_port_windows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tms_trips"
  ADD CONSTRAINT "tms_trips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "tms_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "tms_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_trips_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_trips_outboundWindowId_fkey" FOREIGN KEY ("outboundWindowId") REFERENCES "tms_port_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "tms_trips_returnWindowId_fkey" FOREIGN KEY ("returnWindowId") REFERENCES "tms_port_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
