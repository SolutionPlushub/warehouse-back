-- CreateTable
CREATE TABLE "client_zone_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "quotaM2" DOUBLE PRECISION,
    "isExclusive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_zone_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_zone_allocations_tenantId_idx" ON "client_zone_allocations"("tenantId");

-- CreateIndex
CREATE INDEX "client_zone_allocations_clientId_idx" ON "client_zone_allocations"("clientId");

-- CreateIndex
CREATE INDEX "client_zone_allocations_zoneId_idx" ON "client_zone_allocations"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "client_zone_allocations_clientId_zoneId_key" ON "client_zone_allocations"("clientId", "zoneId");

-- AddForeignKey
ALTER TABLE "client_zone_allocations" ADD CONSTRAINT "client_zone_allocations_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "storage_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_zone_allocations" ADD CONSTRAINT "client_zone_allocations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
