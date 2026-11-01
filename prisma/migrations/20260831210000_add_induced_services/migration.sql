-- Ajoute le catalogue des prestations induites et la tarification métier
-- (TariffRef, InducedServiceRef, OperationInducedRule, ShipmentFileServiceLine).
-- Référence : Note logique de service DMT Hub — voir prisma/schema.prisma
-- pour le détail de chaque modèle. Miroir de DOS_TARIFFS/DOS_SERVICES,
-- INDUCED_SERVICES et OP_INDUCED_MAP côté frontend (lib/data/data-dos.js).

-- CreateEnum
CREATE TYPE "InducedTrigger" AS ENUM ('MANDATORY', 'CONDITIONAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "InducedRuleWhen" AS ENUM ('ALWAYS', 'OVER_FRANCHISE', 'REGIME_MAD', 'REGIME_SPECIAL', 'EXIT_TRUCK', 'STUFFED_CONTAINER', 'SIZE_NATURE', 'REGIME_DERIVED');

-- CreateTable
CREATE TABLE "tariff_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "induced_service_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "trigger" "InducedTrigger" NOT NULL,
    "tariffId" TEXT,
    "size" INTEGER,
    "nature" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "induced_service_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_induced_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operationType" "OperationType" NOT NULL,
    "inducedServiceId" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "when" "InducedRuleWhen",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_induced_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_file_service_lines" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inducedServiceId" TEXT,
    "tariffId" TEXT,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "rate" INTEGER NOT NULL,
    "mandatory" BOOLEAN,
    "ruleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_file_service_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariff_refs_tenantId_idx" ON "tariff_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_refs_tenantId_code_key" ON "tariff_refs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "induced_service_refs_tenantId_idx" ON "induced_service_refs"("tenantId");

-- CreateIndex
CREATE INDEX "induced_service_refs_tariffId_idx" ON "induced_service_refs"("tariffId");

-- CreateIndex
CREATE UNIQUE INDEX "induced_service_refs_tenantId_code_key" ON "induced_service_refs"("tenantId", "code");

-- CreateIndex
CREATE INDEX "operation_induced_rules_tenantId_idx" ON "operation_induced_rules"("tenantId");

-- CreateIndex
CREATE INDEX "operation_induced_rules_inducedServiceId_idx" ON "operation_induced_rules"("inducedServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "operation_induced_rules_tenantId_operationType_inducedServi_key" ON "operation_induced_rules"("tenantId", "operationType", "inducedServiceId");

-- CreateIndex
CREATE INDEX "shipment_file_service_lines_shipmentFileId_idx" ON "shipment_file_service_lines"("shipmentFileId");

-- CreateIndex
CREATE INDEX "shipment_file_service_lines_tenantId_idx" ON "shipment_file_service_lines"("tenantId");

-- AddForeignKey
ALTER TABLE "tariff_refs" ADD CONSTRAINT "tariff_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induced_service_refs" ADD CONSTRAINT "induced_service_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induced_service_refs" ADD CONSTRAINT "induced_service_refs_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "tariff_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_induced_rules" ADD CONSTRAINT "operation_induced_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_induced_rules" ADD CONSTRAINT "operation_induced_rules_inducedServiceId_fkey" FOREIGN KEY ("inducedServiceId") REFERENCES "induced_service_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_service_lines" ADD CONSTRAINT "shipment_file_service_lines_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_service_lines" ADD CONSTRAINT "shipment_file_service_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_service_lines" ADD CONSTRAINT "shipment_file_service_lines_inducedServiceId_fkey" FOREIGN KEY ("inducedServiceId") REFERENCES "induced_service_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_file_service_lines" ADD CONSTRAINT "shipment_file_service_lines_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "tariff_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

