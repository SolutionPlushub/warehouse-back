-- AlterTable
ALTER TABLE "shipment_files" ADD COLUMN     "clientId" TEXT;

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
