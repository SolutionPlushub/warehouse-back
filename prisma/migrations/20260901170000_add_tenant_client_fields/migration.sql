-- Ajoute la "fiche client" au modèle Tenant : préremplit le formulaire de
-- création de dossier (conditions de paiement par défaut, franchise
-- contractuelle, identité légale). Miroir de DOS_CLIENTS côté frontend
-- (lib/data/data-dos.js), qui n'avait pas d'équivalent backend.
-- Champs pertinents seulement pour type=CLIENT, mais placés sur le modèle
-- général avec des défauts (cohérent avec le branding déjà partagé par tous
-- les tenants, y compris les opérateurs).
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contact" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contractOk" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "contractRef" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "defaultFreetimeDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "defaultPaymentMode" TEXT NOT NULL DEFAULT 'virement',
ADD COLUMN     "defaultPaymentTerms" "PaymentTermType" NOT NULL DEFAULT 'ON_CREDIT',
ADD COLUMN     "ninea" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rccm" TEXT NOT NULL DEFAULT '';
