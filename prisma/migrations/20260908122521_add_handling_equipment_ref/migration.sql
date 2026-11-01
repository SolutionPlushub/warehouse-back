-- CreateTable
CREATE TABLE "handling_equipment_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handling_equipment_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handling_equipment_refs_tenantId_idx" ON "handling_equipment_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "handling_equipment_refs_tenantId_name_key" ON "handling_equipment_refs"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "handling_equipment_refs" ADD CONSTRAINT "handling_equipment_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
