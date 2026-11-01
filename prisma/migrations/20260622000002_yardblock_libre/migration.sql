-- Migration: YardBlock libre — enum → string, YardBlockDef configurable par tenant

-- Ajouter la table yard_block_defs
CREATE TABLE "yard_block_defs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "yardId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "maxTier" INTEGER NOT NULL DEFAULT 3,
  "allowDangerousGoods" BOOLEAN NOT NULL DEFAULT false,
  "allowReefer" BOOLEAN NOT NULL DEFAULT false,
  "allowEmpty" BOOLEAN NOT NULL DEFAULT true,
  "allowAllTypes" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "yard_block_defs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "yard_block_defs" ADD CONSTRAINT "yard_block_defs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_block_defs" ADD CONSTRAINT "yard_block_defs_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "yards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "yard_block_defs" ADD CONSTRAINT "yard_block_defs_yardId_code_key" UNIQUE ("yardId", "code");

CREATE INDEX "yard_block_defs_tenantId_idx" ON "yard_block_defs"("tenantId");
CREATE INDEX "yard_block_defs_yardId_idx" ON "yard_block_defs"("yardId");

-- Convertir block de l'enum vers TEXT
-- D'abord ajouter une colonne TEXT temporaire
ALTER TABLE "yard_positions" ADD COLUMN "block_text" TEXT;
UPDATE "yard_positions" SET "block_text" = "block"::TEXT;
ALTER TABLE "yard_positions" DROP COLUMN "block";
ALTER TABLE "yard_positions" RENAME COLUMN "block_text" TO "block";
ALTER TABLE "yard_positions" ALTER COLUMN "block" SET NOT NULL;

-- Ajouter yardBlockDefId nullable
ALTER TABLE "yard_positions" ADD COLUMN "yardBlockDefId" TEXT;
ALTER TABLE "yard_positions" ADD CONSTRAINT "yard_positions_yardBlockDefId_fkey" FOREIGN KEY ("yardBlockDefId") REFERENCES "yard_block_defs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "yard_positions_yardBlockDefId_idx" ON "yard_positions"("yardBlockDefId");

-- Supprimer l'enum YardBlock (après conversion)
DROP TYPE IF EXISTS "YardBlock";
