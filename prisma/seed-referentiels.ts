import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import ws from 'ws';

const DB_URL = process.env.DATABASE_URL!;
const isNeon = DB_URL.includes('neon.tech');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
if (isNeon) {
  neonConfig.webSocketConstructor = ws;
  const adapter = new PrismaNeon({ connectionString: DB_URL });
  prisma = new PrismaClient({ adapter });
} else {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

async function main() {
  const tenants = await prisma.tenant.findMany();
  if (tenants.length === 0) {
    console.log('No tenants found — run the main seed first.');
    return;
  }

  const regimes = [
    { code: 'ENTREPOT_FICTIF', label: 'Entrepôt Fictif',   labelShort: 'EF',    color: '#7C5BC7', bg: '#F5F0FE', sommierDays: 365, sortOrder: 0 },
    { code: 'MAD',             label: 'MAD',               labelShort: 'MAD',   color: '#C29D3D', bg: '#FDF8EE', sortOrder: 1 },
    { code: 'WAREHOUSE_LIBRE', label: 'Entreposage libre', labelShort: 'LIBRE', color: '#15803D', bg: '#F0FDF4', sortOrder: 2 },
  ];
  const shipTypes = [
    { code: 'SEA',  label: 'Maritime', sortOrder: 0 },
    { code: 'AIR',  label: 'Aérien',   sortOrder: 1 },
    { code: 'ROAD', label: 'Routier',  sortOrder: 2 },
  ];
  const pkgTypes = [
    { code: 'PALLET',     label: 'Palette',       sortOrder: 0 },
    { code: 'BOX',        label: 'Carton',         sortOrder: 1 },
    { code: 'WOODEN_BOX', label: 'Caisse en bois', sortOrder: 2 },
    { code: 'VEHICLE',    label: 'Véhicule',       sortOrder: 3 },
    { code: 'CONTAINER',  label: 'Conteneur',      sortOrder: 4 },
    { code: 'OTHER',      label: 'Autre',          sortOrder: 5 },
  ];
  const zones = [
    { code: 'ZONE-A',     label: 'Zone A',                              sortOrder: 0 },
    { code: 'ZONE-B',     label: 'Zone B',                              sortOrder: 1 },
    { code: 'ZONE-C',     label: 'Zone C',                              sortOrder: 2 },
    { code: 'ZONE-D',     label: 'Zone D',                              sortOrder: 3 },
    { code: 'ZONE-DGS',   label: 'Zone DGS (Marchandises dangereuses)', sortOrder: 4 },
    { code: 'ZONE-FRIGO', label: 'Zone Frigorifique',                   sortOrder: 5 },
  ];

  for (const tenant of tenants) {
    console.log(`→ Seeding referentiels for tenant: ${tenant.name} (${tenant.id})`);

    for (const d of regimes) {
      await prisma.storageRegimeRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d },
        update: d,
      });
    }
    for (const d of shipTypes) {
      await prisma.shipmentTypeRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d },
        update: d,
      });
    }
    for (const d of pkgTypes) {
      await prisma.packageTypeRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d },
        update: d,
      });
    }
    for (const d of zones) {
      await prisma.storageZone.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d },
        update: d,
      });
    }
  }

  console.log('✓ Referentiels seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
