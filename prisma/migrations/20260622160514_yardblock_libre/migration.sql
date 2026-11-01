/*
  Warnings:

  - A unique constraint covering the columns `[yardId,block,bay,row,tier]` on the table `yard_positions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "pre_gate_lines" DROP CONSTRAINT "pre_gate_lines_yardContainerId_fkey";

-- AlterTable
ALTER TABLE "container_type_refs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pre_gate_lines" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pre_gates" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipping_line_refs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "container_type_refs_tenantId_idx" ON "container_type_refs"("tenantId");

-- CreateIndex
CREATE INDEX "shipping_line_refs_tenantId_idx" ON "shipping_line_refs"("tenantId");

-- CreateIndex
CREATE INDEX "yard_positions_block_idx" ON "yard_positions"("block");

-- CreateIndex
CREATE UNIQUE INDEX "yard_positions_yardId_block_bay_row_tier_key" ON "yard_positions"("yardId", "block", "bay", "row", "tier");
