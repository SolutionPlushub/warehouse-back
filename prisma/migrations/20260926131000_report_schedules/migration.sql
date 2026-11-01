CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportKind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "weekday" INTEGER,
    "sendTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Dakar',
    "recipients" TEXT[],
    "clientIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_schedules_isActive_nextRunAt_idx"
ON "report_schedules"("isActive", "nextRunAt");

CREATE INDEX "report_schedules_tenantId_idx"
ON "report_schedules"("tenantId");

ALTER TABLE "report_schedules"
ADD CONSTRAINT "report_schedules_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
