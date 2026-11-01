-- Ajoute les 3 codes du cycle de validation hiérarchique N+1 (DRAFT →
-- TO_VALIDATE → REJECTED/DOSSIER_CREE) à OperationStatus, pour aligner sur
-- DOS_STATUS côté frontend (export-nextjs-2, lib/data/data-dos.js).
-- Séparé dans son propre fichier de migration car ALTER TYPE ... ADD VALUE
-- ne peut pas être utilisé dans la même transaction qu'un renommage/usage
-- de ce type (voir migration suivante).
ALTER TYPE "OperationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "OperationStatus" ADD VALUE IF NOT EXISTS 'TO_VALIDATE';
ALTER TYPE "OperationStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
