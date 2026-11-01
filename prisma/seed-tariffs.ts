import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import ws from 'ws';
import { DMT_TARIFF_DEFS, DMT_INDUCED_TARIFF_CODES } from './dmt-tariff-grid';

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
  const onlySlug = process.env.TARIFF_TENANT_SLUG;
  const tenants = await prisma.tenant.findMany({
    where: onlySlug ? { slug: onlySlug } : undefined,
    select: { id: true, name: true, slug: true },
  });
  if (tenants.length === 0) {
    throw new Error(
      onlySlug
        ? `Tenant introuvable : ${onlySlug}`
        : 'Aucun tenant — lancer d’abord le seed principal.',
    );
  }

  const officialCodes = DMT_TARIFF_DEFS.map((d) => d.code);

  for (const tenant of tenants) {
    console.log(`→ Grille DMT 2026 pour ${tenant.name} (${tenant.slug})`);
    const tariffByCode: Record<string, { id: string }> = {};

    for (const d of DMT_TARIFF_DEFS) {
      const t = await prisma.tariffRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d, isActive: true },
        update: { ...d, isActive: true },
      });
      tariffByCode[d.code] = t;
    }

    const deactivated = await prisma.tariffRef.updateMany({
      where: { tenantId: tenant.id, code: { notIn: officialCodes }, isActive: true },
      data: { isActive: false },
    });
    if (deactivated.count) {
      console.log(`  · ${deactivated.count} ancien(s) tarif(s) désactivé(s)`);
    }

    for (const [code, tariffCode] of Object.entries(DMT_INDUCED_TARIFF_CODES)) {
      await prisma.inducedServiceRef.updateMany({
        where: { tenantId: tenant.id, code },
        data: { tariffId: tariffCode ? tariffByCode[tariffCode]?.id ?? null : null },
      });
    }

    console.log(`  · ${DMT_TARIFF_DEFS.length} tarifs officiels upsertés`);
  }

  console.log('✓ Grille tarifaire DMT 2026 seedée.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
