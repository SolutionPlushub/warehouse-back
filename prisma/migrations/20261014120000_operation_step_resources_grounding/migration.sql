-- CreateEnum
CREATE TYPE "HandlingCrewType" AS ENUM ('DOCKERS', 'EXTERNAL_LABOR');

-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "equipmentName" TEXT,
ADD COLUMN     "groundedAt" TIMESTAMP(3),
ADD COLUMN     "handlingCrewCount" INTEGER,
ADD COLUMN     "handlingCrewType" "HandlingCrewType";

-- AlterTable
ALTER TABLE "operation_step_logs" ADD COLUMN     "data" JSONB,
ADD COLUMN     "equipmentName" TEXT,
ADD COLUMN     "handlingCrewCount" INTEGER,
ADD COLUMN     "handlingCrewType" "HandlingCrewType",
ADD COLUMN     "reason" TEXT;

-- Nouvelle étape « Mise à terre » (engin de manutention) dans le pipeline :
--   ICD_FULL / ICD_EMPTY  : insérée en tête (index 0), avant « Placement & EIR » ;
--   DEP_TRANS / DEP_STOCK : insérée après « Réception conteneur » (index 1).
-- OperationLine.stepIdx est un index positionnel dans OPERATION_TYPE_CFG.steps :
-- on décale les unités déjà engagées AU-DELÀ du point d'insertion pour
-- qu'elles restent sur la même étape métier. Décision métier : les unités
-- déjà en cours sautent la nouvelle étape (aucun blocage de dossier en cours).

-- ICD : toute unité existante saute la mise à terre (y compris celles encore
-- à « Placement & EIR », déjà physiquement posées par l'ancien flux).
UPDATE "operation_lines" AS ol
SET "stepIdx" = ol."stepIdx" + 1
FROM "operations" AS o
WHERE o."id" = ol."operationId"
  AND o."type" IN ('ICD_FULL', 'ICD_EMPTY');

-- Dépotages : seules les unités ayant déjà franchi « Réception conteneur »
-- sont décalées ; celles qui ne l'ont pas encore franchie passeront par la
-- mise à terre juste après la réception.
UPDATE "operation_lines" AS ol
SET "stepIdx" = ol."stepIdx" + 1
FROM "operations" AS o
WHERE o."id" = ol."operationId"
  AND o."type" IN ('DEP_TRANS', 'DEP_STOCK')
  AND (ol."stepIdx" >= 1 OR ol."done" = true);
