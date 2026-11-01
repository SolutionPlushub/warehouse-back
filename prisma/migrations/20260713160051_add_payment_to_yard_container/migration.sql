-- AlterTable
ALTER TABLE "yard_containers" ADD COLUMN     "paymentId" TEXT;

-- CreateIndex
CREATE INDEX "yard_containers_paymentId_idx" ON "yard_containers"("paymentId");

-- AddForeignKey
ALTER TABLE "yard_containers" ADD CONSTRAINT "yard_containers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
