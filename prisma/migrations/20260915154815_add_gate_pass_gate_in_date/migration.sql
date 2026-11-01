-- AlterTable
ALTER TABLE "gate_passes" ADD COLUMN     "gateInDate" TIMESTAMP(3);

-- Backfill des passages existants avec leur createdAt réel — plus cohérent
-- qu'un now() générique pour un passage déjà enregistré.
UPDATE "gate_passes" SET "gateInDate" = "createdAt" WHERE "gateInDate" IS NULL;

-- AlterTable
ALTER TABLE "gate_passes" ALTER COLUMN "gateInDate" SET NOT NULL,
ALTER COLUMN "gateInDate" SET DEFAULT CURRENT_TIMESTAMP;
