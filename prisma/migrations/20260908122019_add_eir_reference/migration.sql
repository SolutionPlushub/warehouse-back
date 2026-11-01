-- AlterTable
ALTER TABLE "eirs" ADD COLUMN     "reference" TEXT;

-- Backfill des EIR existants (créés avant l'introduction de la référence
-- lisible) avec une valeur unique déterministe basée sur leur id, pour
-- pouvoir ensuite passer la colonne en NOT NULL sans échec sur une table
-- déjà peuplée.
UPDATE "eirs" SET "reference" = 'EIR-LEGACY-' || "id" WHERE "reference" IS NULL;

-- AlterTable
ALTER TABLE "eirs" ALTER COLUMN "reference" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "eirs_reference_key" ON "eirs"("reference");
