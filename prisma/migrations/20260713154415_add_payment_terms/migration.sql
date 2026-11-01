-- CreateEnum
CREATE TYPE "PaymentTermType" AS ENUM ('AT_PICKUP', 'ON_CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VALIDATED');

-- AlterTable
ALTER TABLE "pre_gates" ADD COLUMN     "paymentId" TEXT;

-- AlterTable
ALTER TABLE "shipment_files" ADD COLUMN     "paymentId" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "termType" "PaymentTermType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pre_gates_paymentId_key" ON "pre_gates"("paymentId");

-- CreateIndex
CREATE INDEX "pre_gates_paymentId_idx" ON "pre_gates"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_files_paymentId_key" ON "shipment_files"("paymentId");

-- CreateIndex
CREATE INDEX "shipment_files_paymentId_idx" ON "shipment_files"("paymentId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_gates" ADD CONSTRAINT "pre_gates_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
