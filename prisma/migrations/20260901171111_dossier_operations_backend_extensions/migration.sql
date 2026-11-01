-- Extension du backend dossier-centrique pour couvrir les comportements du
-- mock frontend (dos-store.js) non encore portés côté Operation :
--   - Bon à Entrer (BAE) + journal d'envoi par e-mail (bonNumber/bonIssuedAt/
--     bonCheck* sur Operation, table entry_pass_emails)
--   - Gate In multi-passages / entrées partielles (table gate_passes)
--   - Facturation du séjour démarrée au placement, arrêtée au Gate Out
--     (storageBillingStartedAt/storageFreetimeDays/storageBillingEndedAt/
--     storageBillableDays sur Operation)
--   - Emplacement affecté par unité (operation_lines.slot, JSON yard ou
--     entrepôt) + workflow d'approbation de changement d'emplacement
--     (table slot_change_approvals)
--   - Blocage comptable au niveau dossier, en plus du blocage client déjà
--     existant (blockedReason/blockedById/blockedAt sur shipment_files)
--   - EIR générique (ShipmentLine ou YardContainer) réutilisé pour
--     l'inspection d'unité au Gate (table eirs)

-- CreateEnum
CREATE TYPE "SlotChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EirReferenceType" AS ENUM ('SHIPMENT_LINE', 'YARD_CONTAINER');

-- CreateEnum
CREATE TYPE "EirType" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "EirCondition" AS ENUM ('GOOD', 'RESERVE', 'DAMAGED');

-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "slot" JSONB;

-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "bonCheckAccount" BOOLEAN,
ADD COLUMN     "bonCheckContract" BOOLEAN,
ADD COLUMN     "bonCheckQuote" BOOLEAN,
ADD COLUMN     "bonIssuedAt" TIMESTAMP(3),
ADD COLUMN     "bonIssuedById" TEXT,
ADD COLUMN     "bonNumber" TEXT,
ADD COLUMN     "storageBillableDays" INTEGER,
ADD COLUMN     "storageBillingEndedAt" TIMESTAMP(3),
ADD COLUMN     "storageBillingStartedAt" TIMESTAMP(3),
ADD COLUMN     "storageFreetimeDays" INTEGER;

-- AlterTable
ALTER TABLE "shipment_files" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT;

-- CreateTable
CREATE TABLE "entry_pass_emails" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "message" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,

    CONSTRAINT "entry_pass_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_passes" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "truckPlate" TEXT NOT NULL,
    "carrier" TEXT,
    "driverName" TEXT NOT NULL,
    "driverCin" TEXT NOT NULL,
    "permitNo" TEXT NOT NULL,
    "arrivedOperationLineIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "gate_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_change_approvals" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationLineId" TEXT NOT NULL,
    "fromSlot" JSONB,
    "toSlot" JSONB NOT NULL,
    "reason" TEXT,
    "status" "SlotChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "slot_change_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eirs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "referenceType" "EirReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "type" "EirType" NOT NULL DEFAULT 'ENTRY',
    "checks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition" "EirCondition" NOT NULL DEFAULT 'GOOD',
    "description" TEXT,
    "damages" JSONB,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eirs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entry_pass_emails_operationId_idx" ON "entry_pass_emails"("operationId");

-- CreateIndex
CREATE INDEX "gate_passes_operationId_idx" ON "gate_passes"("operationId");

-- CreateIndex
CREATE INDEX "slot_change_approvals_operationId_idx" ON "slot_change_approvals"("operationId");

-- CreateIndex
CREATE INDEX "slot_change_approvals_operationLineId_idx" ON "slot_change_approvals"("operationLineId");

-- CreateIndex
CREATE INDEX "slot_change_approvals_status_idx" ON "slot_change_approvals"("status");

-- CreateIndex
CREATE INDEX "eirs_tenantId_idx" ON "eirs"("tenantId");

-- CreateIndex
CREATE INDEX "eirs_referenceType_referenceId_idx" ON "eirs"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "entry_pass_emails" ADD CONSTRAINT "entry_pass_emails_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_change_approvals" ADD CONSTRAINT "slot_change_approvals_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_change_approvals" ADD CONSTRAINT "slot_change_approvals_operationLineId_fkey" FOREIGN KEY ("operationLineId") REFERENCES "operation_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eirs" ADD CONSTRAINT "eirs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
