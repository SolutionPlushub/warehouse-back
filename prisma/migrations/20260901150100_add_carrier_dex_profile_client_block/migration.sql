-- Trois briques de paramétrage DOS sans équivalent backend jusqu'ici —
-- miroir de dos-config-store.js (carriers/dex/blocked) côté frontend.
-- Référentiel transporteurs (créable à la volée depuis le Gate).
CREATE TABLE "carrier_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_refs_pkey" PRIMARY KEY ("id")
);

-- Profil DEX (un par tenant) : signature/cachet/mention apposés sur les
-- bons de sortie.
CREATE TABLE "dex_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Directeur(trice) Exploitation',
    "signatureUrl" TEXT,
    "stampUrl" TEXT,
    "mention" TEXT NOT NULL DEFAULT 'Bon pour sortie — Direction Exploitation',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "dex_profiles_pkey" PRIMARY KEY ("id")
);

-- Blocage comptable d'un client (Tenant type=CLIENT) — empêche toute
-- création de dossier/opération pour ce client tant qu'il n'est pas
-- débloqué.
CREATE TABLE "client_accounting_blocks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedById" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_accounting_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carrier_refs_tenantId_idx" ON "carrier_refs"("tenantId");
CREATE UNIQUE INDEX "carrier_refs_tenantId_name_key" ON "carrier_refs"("tenantId", "name");

CREATE UNIQUE INDEX "dex_profiles_tenantId_key" ON "dex_profiles"("tenantId");

CREATE INDEX "client_accounting_blocks_tenantId_idx" ON "client_accounting_blocks"("tenantId");
CREATE INDEX "client_accounting_blocks_clientId_idx" ON "client_accounting_blocks"("clientId");
CREATE UNIQUE INDEX "client_accounting_blocks_tenantId_clientId_key" ON "client_accounting_blocks"("tenantId", "clientId");

ALTER TABLE "carrier_refs" ADD CONSTRAINT "carrier_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dex_profiles" ADD CONSTRAINT "dex_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_accounting_blocks" ADD CONSTRAINT "client_accounting_blocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_accounting_blocks" ADD CONSTRAINT "client_accounting_blocks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
