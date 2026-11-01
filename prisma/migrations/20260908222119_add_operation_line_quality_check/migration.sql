-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "qualityResult" TEXT,
ADD COLUMN     "qualityNc" TEXT,
ADD COLUMN     "qualityCheckedAt" TIMESTAMP(3);
