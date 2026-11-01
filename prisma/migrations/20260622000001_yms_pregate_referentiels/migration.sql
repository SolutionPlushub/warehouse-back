-- Enum: TransportMode pour PreGate
CREATE TYPE "TransportMode" AS ENUM ('SEA', 'ROAD', 'RAIL', 'AIR');

-- Enum: PreGateStatus
CREATE TYPE "PreGateStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- Enum: PreGateLineStatus
CREATE TYPE "PreGateLineStatus" AS ENUM ('EXPECTED', 'ARRIVED', 'REJECTED', 'EXTRA');

-- Enum: ContainerTypeRefCode (référentiel dynamique)
-- On garde ContainerType enum existant pour YardContainer, on crée un référentiel table séparé

-- Table PreGate
CREATE TABLE "pre_gates" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"      TEXT NOT NULL,
  "yardId"        TEXT NOT NULL,
  "voyageCode"    TEXT NOT NULL,
  "vesselName"    TEXT,
  "eta"           TIMESTAMP(3),
  "shippingLine"  TEXT,
  "transportMode" "TransportMode" NOT NULL DEFAULT 'SEA',
  "status"        "PreGateStatus" NOT NULL DEFAULT 'OPEN',
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pre_gates_pkey" PRIMARY KEY ("id")
);

-- Table PreGateLine
CREATE TABLE "pre_gate_lines" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid(),
  "preGateId"        TEXT NOT NULL,
  "containerNumber"  TEXT NOT NULL,
  "isoTypeCode"      TEXT NOT NULL DEFAULT '20DC',
  "sizeFt"           INTEGER NOT NULL DEFAULT 20,
  "containerType"    "ContainerType" NOT NULL DEFAULT 'DRY',
  "grossWeightKg"    DOUBLE PRECISION,
  "sealNumber"       TEXT,
  "isDangerousGoods" BOOLEAN NOT NULL DEFAULT false,
  "customsHold"      BOOLEAN NOT NULL DEFAULT false,
  "status"           "PreGateLineStatus" NOT NULL DEFAULT 'EXPECTED',
  "yardContainerId"  TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pre_gate_lines_pkey" PRIMARY KEY ("id")
);

-- Table ShippingLineRef (référentiel armateurs)
CREATE TABLE "shipping_line_refs" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"  TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "scac"      TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipping_line_refs_pkey" PRIMARY KEY ("id")
);

-- Table ContainerTypeRef (référentiel types conteneurs)
CREATE TABLE "container_type_refs" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"    TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "isoPrefix"   TEXT,
  "sizeFt"      INTEGER NOT NULL DEFAULT 20,
  "family"      TEXT NOT NULL DEFAULT 'dry',
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "container_type_refs_pkey" PRIMARY KEY ("id")
);

-- Ajouter POSITIONING au enum YardContainerStatus
ALTER TYPE "YardContainerStatus" ADD VALUE IF NOT EXISTS 'POSITIONING';

-- Ajouter preGateLineId sur YardContainer
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "preGateLineId" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "driverName" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "driverPhone" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "truckPlate" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "originLocation" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "destination" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "damages" TEXT[] DEFAULT '{}';

-- Index
CREATE INDEX "pre_gates_tenantId_idx" ON "pre_gates"("tenantId");
CREATE INDEX "pre_gates_yardId_idx" ON "pre_gates"("yardId");
CREATE INDEX "pre_gates_status_idx" ON "pre_gates"("status");
CREATE INDEX "pre_gate_lines_preGateId_idx" ON "pre_gate_lines"("preGateId");
CREATE INDEX "pre_gate_lines_status_idx" ON "pre_gate_lines"("status");
CREATE UNIQUE INDEX "shipping_line_refs_tenantId_code_key" ON "shipping_line_refs"("tenantId", "code");
CREATE UNIQUE INDEX "container_type_refs_tenantId_code_key" ON "container_type_refs"("tenantId", "code");

-- Foreign keys
ALTER TABLE "pre_gates" ADD CONSTRAINT "pre_gates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_gates" ADD CONSTRAINT "pre_gates_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pre_gate_lines" ADD CONSTRAINT "pre_gate_lines_preGateId_fkey" FOREIGN KEY ("preGateId") REFERENCES "pre_gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_gate_lines" ADD CONSTRAINT "pre_gate_lines_yardContainerId_fkey" FOREIGN KEY ("yardContainerId") REFERENCES "yard_containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipping_line_refs" ADD CONSTRAINT "shipping_line_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "container_type_refs" ADD CONSTRAINT "container_type_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
