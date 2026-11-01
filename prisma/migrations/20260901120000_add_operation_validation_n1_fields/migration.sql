-- Ajoute les champs de traçabilité du cycle de validation hiérarchique N+1
-- (DRAFT → TO_VALIDATE → DOSSIER_CREE|REJECTED) sur Operation — miroir de
-- `d.validation{requestedBy,requestedAt,decidedBy,decidedAt,comment}` côté
-- frontend (lib/stores/dos-store.js).
ALTER TABLE "operations" ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionComment" TEXT;
