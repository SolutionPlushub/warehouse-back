-- AlterTable
ALTER TABLE "yard_containers" ADD COLUMN     "isBeingDevanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "shipment_files_yardContainerId_idx" ON "shipment_files"("yardContainerId");

-- AddForeignKey
ALTER TABLE "shipment_files" ADD CONSTRAINT "shipment_files_yardContainerId_fkey" FOREIGN KEY ("yardContainerId") REFERENCES "yard_containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
