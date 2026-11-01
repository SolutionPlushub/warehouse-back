// Seed du catalogue des plans commerciaux SaaS (Plan + PlanPrice).
// Script standalone (pattern de seed-referentiels.ts) — pas importé par
// seed.ts, à exécuter séparément :
//   npx ts-node --project tsconfig.json prisma/seed-plans.ts

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

// Prix mensuel de référence en XOF ; le prix annuel applique une remise de
// 15% sur (mensuel × 12), stocké comme discountPercent sur la ligne YEARLY.
const plans = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Un module au choix, idéal pour démarrer.',
    maxUsers: 5,
    maxYards: 1,
    maxModules: 1,
    includedModules: [] as string[], // pas de whitelist : le module unique est choisi librement à l'inscription
    allModulesIncluded: false,
    trialDays: 14,
    sortOrder: 0,
    monthlyXof: 25_000,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'WMS + YMS, pour un opérateur établi.',
    maxUsers: 20,
    maxYards: 3,
    maxModules: 2,
    includedModules: ['WMS', 'YMS'],
    allModulesIncluded: false,
    trialDays: 14,
    sortOrder: 1,
    monthlyXof: 75_000,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Tous les modules, sans limite — pour un groupe multi-sites.',
    maxUsers: null as number | null,
    maxYards: null as number | null,
    maxModules: null as number | null,
    includedModules: [] as string[],
    allModulesIncluded: true,
    trialDays: 14,
    sortOrder: 2,
    monthlyXof: 200_000,
  },
];

const YEARLY_DISCOUNT_PERCENT = 15;

async function main() {
  console.log('🌱 Seeding plans SaaS...\n');

  for (const p of plans) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        description: p.description,
        maxUsers: p.maxUsers,
        maxYards: p.maxYards,
        maxModules: p.maxModules,
        includedModules: p.includedModules,
        allModulesIncluded: p.allModulesIncluded,
        trialDays: p.trialDays,
        sortOrder: p.sortOrder,
      },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        maxUsers: p.maxUsers,
        maxYards: p.maxYards,
        maxModules: p.maxModules,
        includedModules: p.includedModules,
        allModulesIncluded: p.allModulesIncluded,
        trialDays: p.trialDays,
        sortOrder: p.sortOrder,
      },
    });

    const yearlyXof = Math.round(
      p.monthlyXof * 12 * (1 - YEARLY_DISCOUNT_PERCENT / 100),
    );

    await prisma.planPrice.upsert({
      where: {
        planId_interval_currency: {
          planId: plan.id,
          interval: 'MONTHLY',
          currency: 'XOF',
        },
      },
      update: { amountCents: p.monthlyXof, discountPercent: 0 },
      create: {
        planId: plan.id,
        interval: 'MONTHLY',
        currency: 'XOF',
        amountCents: p.monthlyXof,
        discountPercent: 0,
      },
    });

    await prisma.planPrice.upsert({
      where: {
        planId_interval_currency: {
          planId: plan.id,
          interval: 'YEARLY',
          currency: 'XOF',
        },
      },
      update: { amountCents: yearlyXof, discountPercent: YEARLY_DISCOUNT_PERCENT },
      create: {
        planId: plan.id,
        interval: 'YEARLY',
        currency: 'XOF',
        amountCents: yearlyXof,
        discountPercent: YEARLY_DISCOUNT_PERCENT,
      },
    });

    console.log(
      `✓ ${p.name} — ${p.monthlyXof.toLocaleString('fr-FR')} XOF/mois, ${yearlyXof.toLocaleString('fr-FR')} XOF/an (-${YEARLY_DISCOUNT_PERCENT}%)`,
    );
  }

  console.log('\n✅ Plans SaaS seedés avec succès.\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
