-- AlterTable
ALTER TABLE "operation_lines" ADD COLUMN     "docNumber" TEXT,
ADD COLUMN     "docSentTo" TEXT,
ADD COLUMN     "docIssuedAt" TIMESTAMP(3),
ADD COLUMN     "reportNumber" TEXT,
ADD COLUMN     "reportReceived" INTEGER,
ADD COLUMN     "reportSignDmt" TEXT,
ADD COLUMN     "reportSignThird" TEXT,
ADD COLUMN     "reportIssuedAt" TIMESTAMP(3),
ADD COLUMN     "gateOutDriver" TEXT,
ADD COLUMN     "gateOutDestination" TEXT,
ADD COLUMN     "gateOutAt" TIMESTAMP(3);
