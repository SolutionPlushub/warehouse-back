-- Renomme OperationType sur les 9 codes OP_TYPES/FP-* du nouveau frontend
-- DOS (export-nextjs-2, lib/data/data-dos.js). Voir claude.md, section
-- OPÉRATIONS ET PIPELINE, et le commentaire détaillé de mapping dans
-- prisma/schema.prisma.
--
-- Mapping (ancien → nouveau, code FP-* correspondant) :
--   WAREHOUSE_STORAGE      → ENT_IN      (FP-ENT-001)
--   CONTAINER_STORAGE      → ICD_FULL par défaut (FP-ICD-001) — voir note ci-dessous
--   DEVANNING_TRANSIT      → DEP_TRANS   (FP-DEP-001)
--   DEVANNING_TO_WAREHOUSE → DEP_STOCK   (FP-DEP-002)
--   STUFFING_EXPORT        → EMP_EXPORT  (FP-EMP-001)
--   LOADING_EXPORT         → LOAD_EXPORT (FP-EMP-002)
--   WAREHOUSE_EXIT         → ENT_OUT     (FP-ENT-002)
--   CONTAINER_EXIT         → ICD_OUT     (FP-ICD-003)
--
-- CONTAINER_STORAGE n'a pas d'équivalent 1:1 : le nouveau modèle distingue
-- ICD_FULL (conteneur plein) et ICD_EMPTY (conteneur vide). Les lignes
-- existantes en base DEV ne portent aucune trace exploitable du conteneur
-- d'origine (ni yardContainerId sur le dossier, ni OperationLine), donc
-- basculées par défaut vers ICD_FULL (cas le plus fréquent) — décision
-- validée pour ce jeu de données de DEV, sans conséquence en production
-- (aucune donnée réelle à cette date).

BEGIN;

CREATE TYPE "OperationType_new" AS ENUM ('ICD_FULL', 'ICD_EMPTY', 'ICD_OUT', 'ENT_IN', 'ENT_OUT', 'DEP_TRANS', 'DEP_STOCK', 'EMP_EXPORT', 'LOAD_EXPORT');

ALTER TABLE "operations" ALTER COLUMN "type" TYPE "OperationType_new" USING (
  CASE "type"::text
    WHEN 'WAREHOUSE_STORAGE'      THEN 'ENT_IN'
    WHEN 'CONTAINER_STORAGE'      THEN 'ICD_FULL'
    WHEN 'DEVANNING_TRANSIT'      THEN 'DEP_TRANS'
    WHEN 'DEVANNING_TO_WAREHOUSE' THEN 'DEP_STOCK'
    WHEN 'STUFFING_EXPORT'        THEN 'EMP_EXPORT'
    WHEN 'LOADING_EXPORT'         THEN 'LOAD_EXPORT'
    WHEN 'WAREHOUSE_EXIT'         THEN 'ENT_OUT'
    WHEN 'CONTAINER_EXIT'         THEN 'ICD_OUT'
    ELSE "type"::text
  END
)::"OperationType_new";

ALTER TYPE "OperationType" RENAME TO "OperationType_old";
ALTER TYPE "OperationType_new" RENAME TO "OperationType";
DROP TYPE "OperationType_old";

COMMIT;

-- Operation.status : le cycle démarre désormais en DRAFT (avant soumission
-- N+1) plutôt que directement DOSSIER_CREE.
ALTER TABLE "operations" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
