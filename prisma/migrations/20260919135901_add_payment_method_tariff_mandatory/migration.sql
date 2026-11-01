-- Moyen de règlement effectif (espèces/virement/chèque), distinct de
-- termType (AT_PICKUP/ON_CREDIT) — sert au calcul du timbre fiscal.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHECK');

ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod";

-- Obligatoire/optionnel au niveau du tarif catalogue lui-même — indépendant
-- de OperationInducedRule.mandatory (règle opération→prestation induite).
ALTER TABLE "tariff_refs" ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT false;
