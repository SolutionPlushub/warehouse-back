-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "contacts" JSONB,
ADD COLUMN     "containerPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contractEndsAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'XOF',
ADD COLUMN     "emptyFreetimeDays" INTEGER,
ADD COLUMN     "localAgent" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paymentDelayDays" INTEGER,
ADD COLUMN     "tariffGridLabel" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "yards" ADD COLUMN     "capacityEvp" INTEGER;
