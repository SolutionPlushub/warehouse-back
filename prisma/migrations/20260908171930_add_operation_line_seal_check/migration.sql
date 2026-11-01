-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "sealRead" TEXT,
ADD COLUMN     "sealState" TEXT,
ADD COLUMN     "sealWitness" TEXT,
ADD COLUMN     "sealCheckedAt" TIMESTAMP(3);
