-- AlterTable
ALTER TABLE "pre_gates" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "yard_containers" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "pre_gates_clientId_idx" ON "pre_gates"("clientId");

-- CreateIndex
CREATE INDEX "yard_containers_clientId_idx" ON "yard_containers"("clientId");

-- AddForeignKey
ALTER TABLE "yard_containers" ADD CONSTRAINT "yard_containers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_gates" ADD CONSTRAINT "pre_gates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
