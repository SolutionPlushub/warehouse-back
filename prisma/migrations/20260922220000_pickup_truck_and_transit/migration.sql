-- Camion de reprise (indépendant du Gate In) + régime Transit + tarif détention.

ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupTruckPlate" TEXT;
ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupTruckCarrier" TEXT;
ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupDriverName" TEXT;
ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupDriverCin" TEXT;
ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupPermitNo" TEXT;
ALTER TABLE "operation_lines" ADD COLUMN IF NOT EXISTS "pickupLoadedAt" TIMESTAMP(3);

ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "gateOutCarrier" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "gateOutDriverCin" TEXT;
ALTER TABLE "yard_containers" ADD COLUMN IF NOT EXISTS "gateOutPermitNo" TEXT;

-- Régime douanier Transit (hinterland) pour chaque tenant existant.
INSERT INTO "storage_regime_refs" ("id", "tenantId", "code", "label", "labelShort", "color", "bg", "sortOrder", "createdAt", "updatedAt")
SELECT
  concat('clt', substr(md5(random()::text || t.id), 1, 22)),
  t.id,
  'TRANSIT',
  'Transit hinterland',
  'TRANSIT',
  '#0E7C5A',
  '#ECFDF5',
  3,
  NOW(),
  NOW()
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "storage_regime_refs" s
  WHERE s."tenantId" = t.id AND s.code = 'TRANSIT'
);

-- Tarif détention camion de reprise.
INSERT INTO "tariff_refs" ("id", "tenantId", "code", "domain", "label", "unit", "rate", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  concat('clt', substr(md5(random()::text || t.id || 'T-OPS-07'), 1, 22)),
  t.id,
  'T-OPS-07',
  'Opérations',
  'Détention camion (attente douane)',
  'camion·jour',
  20000,
  true,
  14,
  NOW(),
  NOW()
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "tariff_refs" tr
  WHERE tr."tenantId" = t.id AND tr.code = 'T-OPS-07'
);

-- Prestation induite IS-23.
INSERT INTO "induced_service_refs" ("id", "tenantId", "code", "label", "trigger", "tariffId", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  concat('cli', substr(md5(random()::text || t.id || 'IS-23'), 1, 22)),
  t.id,
  'IS-23',
  'Détention camion (attente douane)',
  'CONDITIONAL',
  tr.id,
  true,
  22,
  NOW(),
  NOW()
FROM "tenants" t
JOIN "tariff_refs" tr ON tr."tenantId" = t.id AND tr.code = 'T-OPS-07'
WHERE NOT EXISTS (
  SELECT 1 FROM "induced_service_refs" s
  WHERE s."tenantId" = t.id AND s.code = 'IS-23'
);
