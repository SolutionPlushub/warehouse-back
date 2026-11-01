-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('WAREHOUSE_STORAGE', 'CONTAINER_STORAGE', 'DEVANNING_TRANSIT', 'DEVANNING_TO_WAREHOUSE', 'STUFFING_EXPORT', 'LOADING_EXPORT', 'WAREHOUSE_EXIT', 'CONTAINER_EXIT');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PRE_ALERTE', 'DOSSIER_CREE', 'CAPACITE_VALIDEE', 'AUTORISE_ENTREE', 'GATE_IN', 'DOCUMENTS_VALIDES', 'EN_OPERATION', 'EN_STOCK', 'ORDRE_SORTIE', 'VALIDATION_FINANCE', 'VALIDATION_DEX', 'LIBERE_SORTIE', 'GATE_OUT', 'SORTI', 'DOSSIER_CLOS');

-- CreateEnum
CREATE TYPE "OperationLineRole" AS ENUM ('INPUT', 'OUTPUT');

-- AlterTable
ALTER TABLE "exit_movements" ADD COLUMN     "operationId" TEXT;

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "shipmentFileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "OperationType" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'DOSSIER_CREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_lines" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "shipmentLineId" TEXT,
    "yardContainerId" TEXT,
    "role" "OperationLineRole" NOT NULL,
    "quantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operations_shipmentFileId_idx" ON "operations"("shipmentFileId");

-- CreateIndex
CREATE INDEX "operations_tenantId_idx" ON "operations"("tenantId");

-- CreateIndex
CREATE INDEX "operations_status_idx" ON "operations"("status");

-- CreateIndex
CREATE INDEX "operation_lines_operationId_idx" ON "operation_lines"("operationId");

-- CreateIndex
CREATE INDEX "operation_lines_shipmentLineId_idx" ON "operation_lines"("shipmentLineId");

-- CreateIndex
CREATE INDEX "operation_lines_yardContainerId_idx" ON "operation_lines"("yardContainerId");

-- CreateIndex
CREATE INDEX "exit_movements_operationId_idx" ON "exit_movements"("operationId");

-- AddForeignKey
ALTER TABLE "exit_movements" ADD CONSTRAINT "exit_movements_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_shipmentFileId_fkey" FOREIGN KEY ("shipmentFileId") REFERENCES "shipment_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_lines" ADD CONSTRAINT "operation_lines_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_lines" ADD CONSTRAINT "operation_lines_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_lines" ADD CONSTRAINT "operation_lines_yardContainerId_fkey" FOREIGN KEY ("yardContainerId") REFERENCES "yard_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill : crée rétroactivement une Operation (WAREHOUSE_EXIT) pour chaque
-- ExitMovement existant, rattachée au même ShipmentFile et tenant, puis
-- reporte le lien operationId. Idempotent-safe car scopé aux ExitMovement
-- qui n'ont pas encore d'operationId.
WITH backfilled AS (
  INSERT INTO "operations" ("id", "shipmentFileId", "tenantId", "type", "status", "createdAt", "closedAt")
  SELECT
    'op_' || em."id",
    em."shipmentFileId",
    em."tenantId",
    'WAREHOUSE_EXIT'::"OperationType",
    (CASE em."status"
      WHEN 'CONFIRMED' THEN 'SORTI'
      WHEN 'CANCELLED' THEN 'DOSSIER_CLOS'
      ELSE 'ORDRE_SORTIE'
    END)::"OperationStatus",
    em."createdAt",
    CASE WHEN em."status" IN ('CONFIRMED', 'CANCELLED') THEN em."updatedAt" ELSE NULL END
  FROM "exit_movements" em
  WHERE em."operationId" IS NULL
  RETURNING "id", "shipmentFileId"
)
UPDATE "exit_movements" em
SET "operationId" = b."id"
FROM backfilled b
WHERE em."shipmentFileId" = b."shipmentFileId" AND em."operationId" IS NULL;

-- Backfill des OperationLine : reporte chaque ExitMovementLine existante en
-- OperationLine role=OUTPUT sur l'Operation nouvellement créée.
INSERT INTO "operation_lines" ("id", "operationId", "shipmentLineId", "role", "quantity", "createdAt")
SELECT
  'opl_' || eml."id",
  em."operationId",
  eml."shipmentLineId",
  'OUTPUT'::"OperationLineRole",
  eml."quantityOut",
  eml."createdAt"
FROM "exit_movement_lines" eml
JOIN "exit_movements" em ON em."id" = eml."exitMovementId"
WHERE em."operationId" IS NOT NULL;
