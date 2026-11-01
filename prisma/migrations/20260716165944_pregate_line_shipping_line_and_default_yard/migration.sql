-- AlterTable
ALTER TABLE "pre_gate_lines" ADD COLUMN     "shippingLine" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultYardId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultYardId_fkey" FOREIGN KEY ("defaultYardId") REFERENCES "yards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: reprend l'armateur du pré-gate comme valeur initiale de
-- chaque conteneur existant (le champ devient éditable par ligne ensuite).
UPDATE "pre_gate_lines" pl
SET "shippingLine" = pg."shippingLine"
FROM "pre_gates" pg
WHERE pl."preGateId" = pg.id
  AND pl."shippingLine" IS NULL
  AND pg."shippingLine" IS NOT NULL;
