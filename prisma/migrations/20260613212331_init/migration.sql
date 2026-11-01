-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('OPERATOR', 'CLIENT');

-- CreateEnum
CREATE TYPE "YardType" AS ENUM ('YARD', 'WAREHOUSE', 'BONDED_WAREHOUSE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT', 'CLIENT', 'CUSTOMS');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('REFRESH', 'PASSWORD_RESET', 'ACCOUNT_CONFIRMATION');

-- CreateEnum
CREATE TYPE "ShipmentFileStatus" AS ENUM ('DRAFT', 'CUSTOMS_PENDING', 'PENDING_PUTAWAY', 'IN_STOCK', 'PARTIAL_OUT', 'FULLY_OUT', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ShipmentLineStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'PARTIAL_OUT', 'OUT');

-- CreateEnum
CREATE TYPE "ExitMovementStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "YardBlock" AS ENUM ('N1', 'N2', 'C1', 'C2', 'E', 'O1', 'O2', 'S1', 'S2', 'S3');

-- CreateEnum
CREATE TYPE "ContainerType" AS ENUM ('DRY', 'REEFER', 'OPEN_TOP', 'FLAT_RACK', 'EMPTY');

-- CreateEnum
CREATE TYPE "YardContainerStatus" AS ENUM ('IN_YARD', 'GATE_IN_PROGRESS', 'GATE_OUT_PROGRESS', 'DEPARTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "YardMovementType" AS ENUM ('GATE_IN', 'REPOSITION', 'GATE_OUT', 'HOUSEKEEPING');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TenantType" NOT NULL DEFAULT 'CLIENT',
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brandColor" TEXT NOT NULL DEFAULT '#0050A0',
    "brandInitials" TEXT NOT NULL DEFAULT 'ORG',
    "brandTagline" TEXT NOT NULL DEFAULT '',
    "brandLogoText" TEXT NOT NULL DEFAULT '',
    "site" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'Business',

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "YardType" NOT NULL DEFAULT 'YARD',
    "surfaceM2" DOUBLE PRECISION,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "yardId" TEXT,
    "voyageCode" TEXT NOT NULL,
    "clientRef" TEXT,
    "invoiceNumber" TEXT,
    "transportDocNumber" TEXT,
    "shipmentTypeCode" TEXT NOT NULL,
    "storageRegimeCode" TEXT NOT NULL,
    "customsDeclNumber" TEXT,
    "customsDeclDate" TIMESTAMP(3),
    "sommierExpiryDate" TIMESTAMP(3),
    "sommierOriginalDate" TIMESTAMP(3),
    "sommierExtendedAt" TIMESTAMP(3),
    "sommierExtendedBy" TEXT,
    "sommierExtensionsUsed" INTEGER NOT NULL DEFAULT 0,
    "eta" TIMESTAMP(3),
    "entryDate" TIMESTAMP(3),
    "status" "ShipmentFileStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "truckPlate" TEXT,
    "targetLocation" TEXT,
    "putawayNote" TEXT,
    "putawayConfirmedAt" TIMESTAMP(3),
    "putawayConfirmedBy" TEXT,
    "yardContainerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_lines" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageRef" TEXT NOT NULL,
    "packageTypeCode" TEXT NOT NULL DEFAULT 'OTHER',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "quantityOut" INTEGER NOT NULL DEFAULT 0,
    "weightKg" DOUBLE PRECISION,
    "volumeM3" DOUBLE PRECISION,
    "surfaceM2" DOUBLE PRECISION,
    "locationId" TEXT,
    "status" "ShipmentLineStatus" NOT NULL DEFAULT 'IN_STOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_movements" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "ExitMovementStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryOrderRef" TEXT,
    "exitDate" TIMESTAMP(3),
    "exitShipmentTypeCode" TEXT,
    "exitVoyageCode" TEXT,
    "exitCustomsDecl" TEXT,
    "exitTransportDoc" TEXT,
    "truckPlate" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "gateOutAt" TIMESTAMP(3),
    "gateOutBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_movement_lines" (
    "id" TEXT NOT NULL,
    "exitMovementId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "quantityOut" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_regime_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelShort" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7C5BC7',
    "bg" TEXT NOT NULL DEFAULT '#F5F0FE',
    "sommierDays" INTEGER,
    "alertThresholds" JSONB NOT NULL DEFAULT '[30, 7, 0]',
    "sommierExtensionDays" INTEGER,
    "sommierMaxExtensions" INTEGER NOT NULL DEFAULT 1,
    "entryFieldConfig" JSONB NOT NULL DEFAULT '[]',
    "exitFieldConfig" JSONB NOT NULL DEFAULT '[]',
    "documentConfig" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_regime_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_type_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_type_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_type_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_type_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_zones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "yardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "surfaceM2" DOUBLE PRECISION,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard_containers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "yardId" TEXT NOT NULL,
    "containerNumber" TEXT NOT NULL,
    "isoTypeCode" TEXT NOT NULL,
    "sizeFt" INTEGER NOT NULL DEFAULT 20,
    "containerType" "ContainerType" NOT NULL DEFAULT 'DRY',
    "grossWeightKg" DOUBLE PRECISION,
    "shippingLine" TEXT,
    "status" "YardContainerStatus" NOT NULL DEFAULT 'IN_YARD',
    "customsHold" BOOLEAN NOT NULL DEFAULT false,
    "isDangerousGoods" BOOLEAN NOT NULL DEFAULT false,
    "sealNumber" TEXT,
    "gateInDate" TIMESTAMP(3),
    "gateOutDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "yardPositionId" TEXT,

    CONSTRAINT "yard_containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard_positions" (
    "id" TEXT NOT NULL,
    "yardId" TEXT NOT NULL,
    "block" "YardBlock" NOT NULL,
    "bay" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "isOccupied" BOOLEAN NOT NULL DEFAULT false,
    "maxTier" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yard_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yard_movements" (
    "id" TEXT NOT NULL,
    "yardContainerId" TEXT NOT NULL,
    "fromPositionId" TEXT,
    "toPositionId" TEXT,
    "movementType" "YardMovementType" NOT NULL,
    "operatorId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yard_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "yards_tenantId_idx" ON "yards"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "yards_tenantId_code_key" ON "yards"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_token_key" ON "tokens"("token");

-- CreateIndex
CREATE INDEX "tokens_token_idx" ON "tokens"("token");

-- CreateIndex
CREATE INDEX "tokens_userId_type_idx" ON "tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "shipment_files_tenantId_idx" ON "shipment_files"("tenantId");

-- CreateIndex
CREATE INDEX "shipment_files_yardId_idx" ON "shipment_files"("yardId");

-- CreateIndex
CREATE INDEX "shipment_files_status_idx" ON "shipment_files"("status");

-- CreateIndex
CREATE INDEX "shipment_lines_shipmentFileId_idx" ON "shipment_lines"("shipmentFileId");

-- CreateIndex
CREATE INDEX "shipment_lines_status_idx" ON "shipment_lines"("status");

-- CreateIndex
CREATE INDEX "exit_movements_shipmentFileId_idx" ON "exit_movements"("shipmentFileId");

-- CreateIndex
CREATE INDEX "exit_movements_status_idx" ON "exit_movements"("status");

-- CreateIndex
CREATE INDEX "exit_movement_lines_exitMovementId_idx" ON "exit_movement_lines"("exitMovementId");

-- CreateIndex
CREATE INDEX "exit_movement_lines_shipmentLineId_idx" ON "exit_movement_lines"("shipmentLineId");

-- CreateIndex
CREATE INDEX "storage_regime_refs_tenantId_idx" ON "storage_regime_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_regime_refs_tenantId_code_key" ON "storage_regime_refs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "shipment_type_refs_tenantId_idx" ON "shipment_type_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_type_refs_tenantId_code_key" ON "shipment_type_refs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "package_type_refs_tenantId_idx" ON "package_type_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "package_type_refs_tenantId_code_key" ON "package_type_refs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "storage_zones_tenantId_idx" ON "storage_zones"("tenantId");

-- CreateIndex
CREATE INDEX "storage_zones_yardId_idx" ON "storage_zones"("yardId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_zones_yardId_code_key" ON "storage_zones"("yardId", "code");

-- CreateIndex
CREATE INDEX "yard_containers_tenantId_idx" ON "yard_containers"("tenantId");

-- CreateIndex
CREATE INDEX "yard_containers_yardId_idx" ON "yard_containers"("yardId");

-- CreateIndex
CREATE INDEX "yard_containers_status_idx" ON "yard_containers"("status");

-- CreateIndex
CREATE INDEX "yard_containers_containerNumber_idx" ON "yard_containers"("containerNumber");

-- CreateIndex
CREATE INDEX "yard_positions_yardId_idx" ON "yard_positions"("yardId");

-- CreateIndex
CREATE INDEX "yard_positions_block_idx" ON "yard_positions"("block");

-- CreateIndex
CREATE INDEX "yard_positions_isOccupied_idx" ON "yard_positions"("isOccupied");

-- CreateIndex
CREATE UNIQUE INDEX "yard_positions_yardId_block_bay_row_tier_key" ON "yard_positions"("yardId", "block", "bay", "row", "tier");

-- CreateIndex
CREATE INDEX "yard_movements_yardContainerId_idx" ON "yard_movements"("yardContainerId");

-- CreateIndex
CREATE INDEX "yard_movements_movementType_idx" ON "yard_movements"("movementType");

-- AddForeignKey
ALTER TABLE "yards" ADD CONSTRAINT "yards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_tenantId_shipmentTypeCode_fkey" FOREIGN KEY ("tenantId", "shipmentTypeCode") REFERENCES "shipment_type_refs"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_tenantId_storageRegimeCode_fkey" FOREIGN KEY ("tenantId", "storageRegimeCode") REFERENCES "storage_regime_refs"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_tenantId_packageTypeCode_fkey" FOREIGN KEY ("tenantId", "packageTypeCode") REFERENCES "package_type_refs"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_movements" ADD CONSTRAINT "exit_movements_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_movements" ADD CONSTRAINT "exit_movements_tenantId_exitShipmentTypeCode_fkey" FOREIGN KEY ("tenantId", "exitShipmentTypeCode") REFERENCES "shipment_type_refs"("tenantId", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_movement_lines" ADD CONSTRAINT "exit_movement_lines_exitMovementId_fkey" FOREIGN KEY ("exitMovementId") REFERENCES "exit_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_movement_lines" ADD CONSTRAINT "exit_movement_lines_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_regime_refs" ADD CONSTRAINT "storage_regime_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_type_refs" ADD CONSTRAINT "shipment_type_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_type_refs" ADD CONSTRAINT "package_type_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_zones" ADD CONSTRAINT "storage_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_zones" ADD CONSTRAINT "storage_zones_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_containers" ADD CONSTRAINT "yard_containers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_containers" ADD CONSTRAINT "yard_containers_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_containers" ADD CONSTRAINT "yard_containers_yardPositionId_fkey" FOREIGN KEY ("yardPositionId") REFERENCES "yard_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_positions" ADD CONSTRAINT "yard_positions_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_movements" ADD CONSTRAINT "yard_movements_yardContainerId_fkey" FOREIGN KEY ("yardContainerId") REFERENCES "yard_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_movements" ADD CONSTRAINT "yard_movements_fromPositionId_fkey" FOREIGN KEY ("fromPositionId") REFERENCES "yard_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_movements" ADD CONSTRAINT "yard_movements_toPositionId_fkey" FOREIGN KEY ("toPositionId") REFERENCES "yard_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yard_movements" ADD CONSTRAINT "yard_movements_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
