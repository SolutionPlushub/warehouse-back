ALTER TABLE "shipment_file_documents"
  ADD COLUMN IF NOT EXISTS "blobName" TEXT,
  ADD COLUMN IF NOT EXISTS "originalName" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_file_documents_blobName_key"
  ON "shipment_file_documents"("blobName")
  WHERE "blobName" IS NOT NULL;
