import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import ws from 'ws';
import * as bcrypt from 'bcrypt';
import { DMT_TARIFF_DEFS, DMT_INDUCED_TARIFF_CODES } from './dmt-tariff-grid';
import { syncAccessCatalog } from '../src/access-control/sync-access-catalog';

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

const hash = (pwd: string) => bcrypt.hash(pwd, 12);

// ── Helpers ──────────────────────────────────────────────────────────────────
const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function daysAgo(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() - n); return d;
}
function daysFrom(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() + n); return d;
}

// ── Référentiels ─────────────────────────────────────────────────────────────
const regimes = [
  {
    code: 'ENTREPOT_FICTIF', label: 'Entrepôt Fictif', labelShort: 'EF',
    color: '#7C5BC7', bg: '#F5F0FE', sommierDays: 365,
    alertThresholds: [30, 7, 0],
    entryFieldConfig: [
      { field: 'voyageCode',         label: 'Code voyage',             required: true,  section: 'identification' },
      { field: 'clientRef',          label: 'Référence client',        required: true,  section: 'identification' },
      { field: 'invoiceNumber',      label: 'N° facture',              required: true,  section: 'identification' },
      { field: 'transportDocNumber', label: 'N° connaissement / LTA',  required: true,  section: 'identification' },
      { field: 'eta',                label: 'ETA',                     required: true,  section: 'transport' },
      { field: 'customsDeclNumber',  label: 'N° déclaration douane',   required: true,  section: 'douane' },
      { field: 'customsDeclDate',    label: 'Date déclaration',        required: true,  section: 'douane' },
      { field: 'notes',              label: 'Observations',            required: false, section: 'divers' },
    ],
    exitFieldConfig: [
      { field: 'deliveryOrderRef', label: 'Référence bon de livraison', required: true,  section: 'bl' },
      { field: 'exitCustomsDecl',  label: 'N° déclaration sortie',      required: true,  section: 'douane' },
      { field: 'exitVoyageCode',   label: 'Code voyage sortant',        required: false, section: 'transport' },
      { field: 'exitTransportDoc', label: 'N° doc transport sortant',   required: false, section: 'transport' },
      { field: 'truckPlate',       label: 'Immatriculation camion',     required: false, section: 'gate' },
      { field: 'driverName',       label: 'Nom chauffeur',              required: false, section: 'gate' },
      { field: 'notes',            label: 'Observations',               required: false, section: 'divers' },
    ],
    documentConfig: [
      { type: 'BON_ENTREE',    label: "Bon d'entrée",        phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'DECLARATION',   label: 'Déclaration douane',  phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'FACTURE',       label: 'Facture commerciale', phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'CONNAISSEMENT', label: 'Connaissement / LTA', phase: 'entry', uploadRequired: false, mailAllowed: true  },
      { type: 'BON_SORTIE',    label: 'Bon de sortie',       phase: 'exit',  uploadRequired: true,  mailAllowed: false },
      { type: 'MAINLEVEE',     label: 'Mainlevée douanière', phase: 'exit',  uploadRequired: true,  mailAllowed: true  },
    ],
    sortOrder: 0,
  },
  {
    code: 'MAD', label: 'MAD', labelShort: 'MAD',
    color: '#C29D3D', bg: '#FDF8EE', sommierDays: null,
    alertThresholds: [],
    entryFieldConfig: [
      { field: 'voyageCode',         label: 'Code voyage',            required: true,  section: 'identification' },
      { field: 'clientRef',          label: 'Référence client',       required: true,  section: 'identification' },
      { field: 'invoiceNumber',      label: 'N° facture',             required: false, section: 'identification' },
      { field: 'transportDocNumber', label: 'N° connaissement / LTA', required: false, section: 'identification' },
      { field: 'eta',                label: 'ETA',                    required: true,  section: 'transport' },
      { field: 'customsDeclNumber',  label: 'N° déclaration douane',  required: false, section: 'douane' },
      { field: 'customsDeclDate',    label: 'Date déclaration',       required: false, section: 'douane' },
      { field: 'notes',              label: 'Observations',           required: false, section: 'divers' },
    ],
    exitFieldConfig: [
      { field: 'deliveryOrderRef', label: 'Référence bon de livraison', required: true,  section: 'bl' },
      { field: 'exitCustomsDecl',  label: 'N° déclaration sortie',      required: false, section: 'douane' },
      { field: 'truckPlate',       label: 'Immatriculation camion',     required: false, section: 'gate' },
      { field: 'driverName',       label: 'Nom chauffeur',              required: false, section: 'gate' },
      { field: 'notes',            label: 'Observations',               required: false, section: 'divers' },
    ],
    documentConfig: [
      { type: 'BON_ENTREE', label: "Bon d'entrée",        phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'FACTURE',    label: 'Facture commerciale',  phase: 'entry', uploadRequired: false, mailAllowed: true  },
      { type: 'BON_SORTIE', label: 'Bon de sortie',        phase: 'exit',  uploadRequired: true,  mailAllowed: false },
    ],
    sortOrder: 1,
  },
  {
    code: 'TRANSIT', label: 'Transit hinterland', labelShort: 'TRANSIT',
    color: '#0E7C5A', bg: '#ECFDF5', sommierDays: null,
    alertThresholds: [],
    entryFieldConfig: [
      { field: 'voyageCode',         label: 'Code voyage',            required: true,  section: 'identification' },
      { field: 'clientRef',          label: 'Référence client',       required: false, section: 'identification' },
      { field: 'transportDocNumber', label: 'N° document de transit', required: true,  section: 'identification' },
      { field: 'eta',                label: 'ETA',                    required: true,  section: 'transport' },
      { field: 'notes',              label: 'Observations',           required: false, section: 'divers' },
    ],
    exitFieldConfig: [
      { field: 'deliveryOrderRef', label: 'Référence bon de livraison', required: true,  section: 'bl' },
      { field: 'truckPlate',       label: 'Immatriculation camion',     required: true,  section: 'gate' },
      { field: 'driverName',       label: 'Nom chauffeur',              required: true,  section: 'gate' },
      { field: 'notes',            label: 'Observations',               required: false, section: 'divers' },
    ],
    documentConfig: [
      { type: 'BON_ENTREE', label: "Bon d'entrée",         phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'T1',         label: 'Document de transit',  phase: 'entry', uploadRequired: true,  mailAllowed: true  },
      { type: 'BON_SORTIE', label: 'Bon de sortie',        phase: 'exit',  uploadRequired: true,  mailAllowed: false },
    ],
    sortOrder: 3,
  },
  {
    code: 'WAREHOUSE_LIBRE', label: 'Entreposage libre', labelShort: 'LIBRE',
    color: '#15803D', bg: '#F0FDF4', sommierDays: null,
    alertThresholds: [],
    entryFieldConfig: [
      { field: 'voyageCode', label: 'Code voyage',      required: true,  section: 'identification' },
      { field: 'clientRef',  label: 'Référence client', required: false, section: 'identification' },
      { field: 'invoiceNumber', label: 'N° facture',    required: false, section: 'identification' },
      { field: 'eta',        label: 'ETA',              required: false, section: 'transport' },
      { field: 'notes',      label: 'Observations',     required: false, section: 'divers' },
    ],
    exitFieldConfig: [
      { field: 'deliveryOrderRef', label: 'Référence bon de livraison', required: true,  section: 'bl' },
      { field: 'truckPlate',       label: 'Immatriculation camion',     required: true,  section: 'gate' },
      { field: 'driverName',       label: 'Nom chauffeur',              required: false, section: 'gate' },
      { field: 'notes',            label: 'Observations',               required: false, section: 'divers' },
    ],
    documentConfig: [
      { type: 'BON_ENTREE', label: "Bon d'entrée",  phase: 'entry', uploadRequired: true,  mailAllowed: false },
      { type: 'BON_SORTIE', label: 'Bon de sortie', phase: 'exit',  uploadRequired: false, mailAllowed: false },
    ],
    sortOrder: 2,
  },
];

const shipTypes = [
  { code: 'SEA',  label: 'Maritime', icon: 'ship',  sortOrder: 0 },
  { code: 'AIR',  label: 'Aérien',   icon: 'plane', sortOrder: 1 },
  { code: 'ROAD', label: 'Routier',  icon: 'truck', sortOrder: 2 },
];
const pkgTypes = [
  { code: 'PALLET',     label: 'Palette',        sortOrder: 0 },
  { code: 'BOX',        label: 'Carton',          sortOrder: 1 },
  { code: 'WOODEN_BOX', label: 'Caisse en bois',  sortOrder: 2 },
  { code: 'VEHICLE',    label: 'Véhicule',        sortOrder: 3 },
  { code: 'CONTAINER',  label: 'Conteneur',       sortOrder: 4 },
  { code: 'OTHER',      label: 'Autre',           sortOrder: 5 },
];
const zonesDefs = [
  { code: 'ZONE-A',     label: 'Zone A',                              sortOrder: 0 },
  { code: 'ZONE-B',     label: 'Zone B',                              sortOrder: 1 },
  { code: 'ZONE-C',     label: 'Zone C',                              sortOrder: 2 },
  { code: 'ZONE-D',     label: 'Zone D',                              sortOrder: 3 },
  { code: 'ZONE-DGS',   label: 'Zone DGS (Marchandises dangereuses)', sortOrder: 4 },
  { code: 'ZONE-FRIGO', label: 'Zone Frigorifique',                   sortOrder: 5 },
];

// ── Grille tarifaire unique DMT 2026 (docs/DMT - Grille Tarifaire Unique.xlsx)
const tariffDefs = DMT_TARIFF_DEFS;

// ── Catalogue des prestations induites — miroir INDUCED_SERVICES
// (lib/data/data-dos.js) et §3 de la Note logique de service DMT Hub.
// tariffCode réfère à tariffDefs ci-dessus ; null = résolue sans tarif direct
// (dérivée du régime, ou taille/nature — voir size/nature).
const inducedServiceDefs: Array<{
  code: string; label: string; trigger: 'MANDATORY' | 'CONDITIONAL' | 'MANUAL';
  tariffCode: string | null; size?: number; nature?: string; sortOrder: number;
}> = [
  { code: 'IS-01', label: 'Formalités Douanes (entrée/sortie entrepôt)', trigger: 'CONDITIONAL', tariffCode: null,        sortOrder: 0 },
  { code: 'IS-02', label: 'Formalités Transfert MAD',                    trigger: 'CONDITIONAL', tariffCode: null,        sortOrder: 1 },
  { code: 'IS-03', label: 'Transfert Port → ICD',                        trigger: 'MANDATORY',   tariffCode: null,        sortOrder: 2 },
  { code: 'IS-04', label: 'Transfert Port → MAD',                        trigger: 'MANDATORY',   tariffCode: null,        sortOrder: 3 },
  { code: 'IS-05', label: 'Relevage (lift off · lift on)',               trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-05'], sortOrder: 4 },
  { code: 'IS-06', label: 'Magasinage (par EVP/jour)',                   trigger: 'CONDITIONAL', tariffCode: DMT_INDUCED_TARIFF_CODES['IS-06'], sortOrder: 5 },
  { code: 'IS-07', label: "Dépotage 20' Vrac",                           trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-07'], size: 20, nature: 'Vrac',          sortOrder: 6 },
  { code: 'IS-08', label: "Empotage 20' Vrac",                           trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-08'], size: 20, nature: 'Vrac',          sortOrder: 7 },
  { code: 'IS-09', label: "Dépotage 20' Conventionnel",                  trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-09'], size: 20, nature: 'Conventionnel', sortOrder: 8 },
  { code: 'IS-10', label: "Empotage 20' Conventionnel",                  trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-10'], size: 20, nature: 'Conventionnel', sortOrder: 9 },
  { code: 'IS-11', label: "Dépotage 40' Vrac",                           trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-11'], size: 40, nature: 'Vrac',          sortOrder: 10 },
  { code: 'IS-12', label: "Empotage 40' Vrac",                           trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-12'], size: 40, nature: 'Vrac',          sortOrder: 11 },
  { code: 'IS-13', label: "Dépotage 40' Conventionnel",                  trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-13'], size: 40, nature: 'Conventionnel', sortOrder: 12 },
  { code: 'IS-14', label: "Empotage 40' Conventionnel",                  trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-14'], size: 40, nature: 'Conventionnel', sortOrder: 13 },
  { code: 'IS-15', label: 'Stockage (yard)',                             trigger: 'MANDATORY',   tariffCode: null,        sortOrder: 14 },
  { code: 'IS-16', label: 'Stockage en entrepôt fictif',                 trigger: 'MANDATORY',   tariffCode: null,        sortOrder: 15 },
  { code: 'IS-17', label: 'Stockage en entrepôt',                        trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-17'], sortOrder: 16 },
  { code: 'IS-18', label: 'Manutention in (tonne ou palette)',           trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-18'], sortOrder: 17 },
  { code: 'IS-19', label: 'Manutention out (tonne ou palette)',          trigger: 'MANDATORY',   tariffCode: DMT_INDUCED_TARIFF_CODES['IS-19'], sortOrder: 18 },
  { code: 'IS-20', label: 'Chargement camion Vrac',                      trigger: 'CONDITIONAL', tariffCode: DMT_INDUCED_TARIFF_CODES['IS-20'], sortOrder: 19 },
  { code: 'IS-21', label: 'Chargement camion Conventionnel',             trigger: 'CONDITIONAL', tariffCode: DMT_INDUCED_TARIFF_CODES['IS-21'], sortOrder: 20 },
  { code: 'IS-22', label: 'Autre',                                       trigger: 'MANUAL',      tariffCode: null,        sortOrder: 21 },
  { code: 'IS-23', label: 'Détention camion (attente douane)',           trigger: 'CONDITIONAL', tariffCode: DMT_INDUCED_TARIFF_CODES['IS-23'], sortOrder: 22 },
];

// ── Mapping OperationType → prestations induites — miroir OP_INDUCED_MAP
// (lib/data/data-dos.js) et §4 de la Note logique de service DMT Hub.
// Le stockage (IS-15/16/17) n'est volontairement listé nulle part ici : il
// est dérivé automatiquement du régime douanier par le moteur de résolution
// (règle §5 — "ce choix ne doit pas être ressaisi manuellement").
const operationInducedRuleDefs: Array<{
  operationType: string;
  mandatory: string[];
  conditional: Array<{ code: string; when: string }>;
}> = [
  { operationType: 'ICD_FULL',    mandatory: ['IS-03', 'IS-05'],          conditional: [{ code: 'IS-06', when: 'OVER_FRANCHISE' }, { code: 'IS-02', when: 'REGIME_MAD' }] },
  { operationType: 'ICD_EMPTY',   mandatory: ['IS-03', 'IS-05'],          conditional: [{ code: 'IS-01', when: 'REGIME_SPECIAL' }] },
  { operationType: 'ICD_OUT',     mandatory: ['IS-05', 'IS-01'],          conditional: [{ code: 'IS-06', when: 'OVER_FRANCHISE' }, { code: 'IS-20', when: 'EXIT_TRUCK' }, { code: 'IS-21', when: 'EXIT_TRUCK' }] },
  { operationType: 'ENT_IN',      mandatory: ['IS-03', 'IS-18'],          conditional: [{ code: 'IS-01', when: 'ALWAYS' }, { code: 'IS-02', when: 'REGIME_MAD' }] },
  { operationType: 'ENT_OUT',     mandatory: ['IS-19'],                   conditional: [{ code: 'IS-01', when: 'ALWAYS' }, { code: 'IS-20', when: 'EXIT_TRUCK' }, { code: 'IS-21', when: 'EXIT_TRUCK' }] },
  { operationType: 'DEP_TRANS',   mandatory: ['IS-05', 'IS-19'],          conditional: [] },
  { operationType: 'DEP_STOCK',   mandatory: ['IS-05', 'IS-18'],          conditional: [{ code: 'IS-01', when: 'ALWAYS' }] },
  { operationType: 'EMP_EXPORT',  mandatory: ['IS-05', 'IS-18'],          conditional: [{ code: 'IS-03', when: 'ALWAYS' }, { code: 'IS-01', when: 'ALWAYS' }] },
  { operationType: 'LOAD_EXPORT', mandatory: ['IS-19', 'IS-21'],          conditional: [{ code: 'IS-10', when: 'STUFFED_CONTAINER' }, { code: 'IS-14', when: 'STUFFED_CONTAINER' }] },
];

async function main() {
  await syncAccessCatalog(prisma);
  console.log('✓ Catalogue de permissions et profils système');
  console.log('🌱 Seeding database...\n');

  // ── 1. TENANTS ─────────────────────────────────────────────────────────────
  const dmt = await prisma.tenant.upsert({
    where: { slug: 'dmt-dakar' },
    update: { brandLogoText: 'DMT Hub' },
    create: {
      name: 'DMT Hub Logistique Dakar', slug: 'dmt-dakar', type: 'OPERATOR',
      site: 'Port Autonome de Dakar', plan: 'Enterprise',
      brandColor: '#0050A0', brandInitials: 'DMT',
      brandTagline: 'Hub Logistique Portuaire', brandLogoText: 'DMT Hub',
    },
  });

  const fracht = await prisma.tenant.upsert({
    where: { slug: 'fracht-senegal' },
    update: {},
    create: {
      name: 'Fracht FWO Sénégal', slug: 'fracht-senegal', type: 'CLIENT',
      site: 'Dakar, Sénégal', plan: 'Business',
      brandColor: '#0E7C5A', brandInitials: 'FRC',
      brandTagline: 'Freight Forwarding', brandLogoText: 'Fracht Sénégal',
    },
  });

  const mota = await prisma.tenant.upsert({
    where: { slug: 'mota-logistics' },
    update: {},
    create: {
      name: 'MOTA Logistics', slug: 'mota-logistics', type: 'CLIENT',
      site: 'Dakar, Sénégal', plan: 'Business',
      brandColor: '#B8442B', brandInitials: 'MOT',
      brandTagline: 'Transport & Logistics', brandLogoText: 'MOTA',
    },
  });

  console.log('✓ Tenants : DMT, Fracht, MOTA');

  // ── 2. UTILISATEURS ────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'super@solution-plus.es' },
    update: {},
    create: { email: 'super@solution-plus.es', passwordHash: await hash('Admin@2026!'), firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN', tenantId: null, isActive: true },
  });
  await prisma.user.upsert({
    where: { email: 'admin@dmt.sn' },
    update: {},
    create: { tenantId: dmt.id, email: 'admin@dmt.sn', passwordHash: await hash('Admin@2026!'), firstName: 'Aminata', lastName: 'Diop', role: 'ADMIN', isActive: true },
  });
  await prisma.user.upsert({
    where: { email: 'k.benali@dmt.sn' },
    update: {},
    create: { tenantId: dmt.id, email: 'k.benali@dmt.sn', passwordHash: await hash('Admin@2026!'), firstName: 'Karim', lastName: 'Benali', role: 'AGENT', isActive: true },
  });
  await prisma.user.upsert({
    where: { email: 'douane@dmt.sn' },
    update: {},
    create: { tenantId: dmt.id, email: 'douane@dmt.sn', passwordHash: await hash('Admin@2026!'), firstName: 'Sophie', lastName: 'Marchand', role: 'CUSTOMS', isActive: true },
  });
  await prisma.user.upsert({
    where: { email: 'admin@fracht-sn.com' },
    update: {},
    create: { tenantId: fracht.id, email: 'admin@fracht-sn.com', passwordHash: await hash('Admin@2026!'), firstName: 'Aliou', lastName: 'Sané', role: 'ADMIN', isActive: true },
  });
  await prisma.user.upsert({
    where: { email: 'admin@mota-sn.com' },
    update: {},
    create: { tenantId: mota.id, email: 'admin@mota-sn.com', passwordHash: await hash('Admin@2026!'), firstName: 'Carlos', lastName: 'Mendes', role: 'ADMIN', isActive: true },
  });
  console.log('✓ Utilisateurs créés');

  // ── 3. YARDS ───────────────────────────────────────────────────────────────
  const dmtYard = await prisma.yard.upsert({
    where: { tenantId_code: { tenantId: dmt.id, code: 'ICD-DAKAR' } },
    update: {},
    create: { tenantId: dmt.id, code: 'ICD-DAKAR', name: 'ICD Dakar — Zone Portuaire', type: 'YARD', city: 'Dakar', country: 'SN', address: 'Port Autonome de Dakar, ICD', sortOrder: 0 },
  });
  const dmtWarehouse = await prisma.yard.upsert({
    where: { tenantId_code: { tenantId: dmt.id, code: 'WH-DAKAR-VILLE' } },
    update: {},
    create: { tenantId: dmt.id, code: 'WH-DAKAR-VILLE', name: 'Entrepôt DMT — Centre Ville', type: 'WAREHOUSE', city: 'Dakar', country: 'SN', address: 'Zone Industrielle Hann', sortOrder: 1 },
  });
  const frachtYard = await prisma.yard.upsert({
    where: { tenantId_code: { tenantId: fracht.id, code: 'FRACHT-WH' } },
    update: {},
    create: { tenantId: fracht.id, code: 'FRACHT-WH', name: 'Entrepôt Fracht Sénégal', type: 'BONDED_WAREHOUSE', city: 'Dakar', country: 'SN', sortOrder: 0 },
  });
  const motaYard = await prisma.yard.upsert({
    where: { tenantId_code: { tenantId: mota.id, code: 'MOTA-WH' } },
    update: {},
    create: { tenantId: mota.id, code: 'MOTA-WH', name: 'Entrepôt MOTA Logistics', type: 'WAREHOUSE', city: 'Dakar', country: 'SN', sortOrder: 0 },
  });
  console.log('✓ Yards : ICD-DAKAR, WH-DAKAR-VILLE, FRACHT-WH, MOTA-WH');

  // ── 4. YARD BLOCK DEFS + POSITIONS (layout ICD Dakar) ─────────────────────
  const blockLayout: Array<{
    code: string;
    label: string;
    bays: number[];
    rows: number[];
    tiers: number[];
    maxTier: number;
    allowDangerousGoods: boolean;
    allowReefer: boolean;
    allowEmpty: boolean;
    allowAllTypes: boolean;
    sortOrder: number;
  }> = [
    { code: 'N1', label: 'Zone Nord 1',  bays: r(1,6), rows: r(1,3), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: true,  allowEmpty: false, allowAllTypes: false, sortOrder: 0 },
    { code: 'N2', label: 'Zone Nord 2',  bays: r(1,5), rows: [1],    tiers: r(1,2), maxTier: 2, allowDangerousGoods: false, allowReefer: true,  allowEmpty: false, allowAllTypes: false, sortOrder: 1 },
    { code: 'C1', label: 'Zone Centre 1',bays: r(1,2), rows: r(1,6), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: false, allowAllTypes: true,  sortOrder: 2 },
    { code: 'C2', label: 'Zone Centre 2',bays: r(1,2), rows: r(1,3), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: false, allowAllTypes: true,  sortOrder: 3 },
    { code: 'E',  label: 'Zone Est',     bays: r(1,2), rows: r(1,6), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: false, allowAllTypes: true,  sortOrder: 4 },
    { code: 'O1', label: 'Zone Ouest 1', bays: r(1,4), rows: r(1,3), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: true,  allowAllTypes: false, sortOrder: 5 },
    { code: 'O2', label: 'Zone Ouest 2', bays: r(1,4), rows: r(1,3), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: true,  allowAllTypes: false, sortOrder: 6 },
    { code: 'S1', label: 'Zone Sud 1',   bays: r(1,4), rows: r(1,4), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: false, allowAllTypes: true,  sortOrder: 7 },
    { code: 'S2', label: 'Zone Sud 2',   bays: r(1,4), rows: r(1,2), tiers: r(1,3), maxTier: 3, allowDangerousGoods: false, allowReefer: false, allowEmpty: false, allowAllTypes: true,  sortOrder: 8 },
    { code: 'S3', label: 'Zone DGS',     bays: r(1,2), rows: [1],    tiers: r(1,2), maxTier: 2, allowDangerousGoods: true,  allowReefer: false, allowEmpty: false, allowAllTypes: false, sortOrder: 9 },
  ];

  let totalPosCreated = 0;
  for (const def of blockLayout) {
    // Upsert YardBlockDef
    const blockDef = await prisma.yardBlockDef.upsert({
      where: { yardId_code: { yardId: dmtYard.id, code: def.code } },
      update: {
        label: def.label,
        maxTier: def.maxTier,
        allowDangerousGoods: def.allowDangerousGoods,
        allowReefer: def.allowReefer,
        allowEmpty: def.allowEmpty,
        allowAllTypes: def.allowAllTypes,
        sortOrder: def.sortOrder,
      },
      create: {
        tenantId: dmt.id,
        yardId: dmtYard.id,
        code: def.code,
        label: def.label,
        maxTier: def.maxTier,
        allowDangerousGoods: def.allowDangerousGoods,
        allowReefer: def.allowReefer,
        allowEmpty: def.allowEmpty,
        allowAllTypes: def.allowAllTypes,
        sortOrder: def.sortOrder,
      },
    });

    // Génère les positions
    const positions: any[] = [];
    for (const bay of def.bays)
      for (const row of def.rows)
        for (const tier of def.tiers)
          positions.push({
            yardId: dmtYard.id,
            block: def.code,
            yardBlockDefId: blockDef.id,
            bay, row, tier,
            maxTier: def.maxTier,
            isOccupied: false,
          });

    const res = await prisma.yardPosition.createMany({ data: positions, skipDuplicates: true });
    totalPosCreated += res.count;
  }
  console.log(`✓ Yard block defs : ${blockLayout.length} blocs (ICD Dakar)`);
  console.log(`✓ Yard positions : ${totalPosCreated} créées / ignorées si déjà existantes (ICD Dakar)`);

  // ── 5. RÉFÉRENTIELS ────────────────────────────────────────────────────────
  const allTenantYards = [
    { tenant: dmt,    yard: dmtYard },
    { tenant: fracht, yard: frachtYard },
    { tenant: mota,   yard: motaYard },
  ];
  for (const { tenant, yard } of allTenantYards) {
    for (const d of regimes)
      await prisma.storageRegimeRef.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: d.code } }, create: { tenantId: tenant.id, ...d }, update: d });
    for (const d of shipTypes)
      await prisma.shipmentTypeRef.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: d.code } }, create: { tenantId: tenant.id, ...d }, update: d });
    for (const d of pkgTypes)
      await prisma.packageTypeRef.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: d.code } }, create: { tenantId: tenant.id, ...d }, update: d });
    for (const d of zonesDefs)
      await prisma.storageZone.upsert({ where: { yardId_code: { yardId: yard.id, code: d.code } }, create: { tenantId: tenant.id, yardId: yard.id, ...d }, update: d });

    // Grille tarifaire
    const tariffByCode: Record<string, { id: string }> = {};
    for (const d of tariffDefs) {
      const t = await prisma.tariffRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...d },
        update: d,
      });
      tariffByCode[d.code] = t;
    }

    // Catalogue des prestations induites (Note logique de service DMT Hub)
    const inducedByCode: Record<string, { id: string }> = {};
    for (const d of inducedServiceDefs) {
      const { tariffCode, ...rest } = d;
      const s = await prisma.inducedServiceRef.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: d.code } },
        create: { tenantId: tenant.id, ...rest, tariffId: tariffCode ? tariffByCode[tariffCode].id : null },
        update: { ...rest, tariffId: tariffCode ? tariffByCode[tariffCode].id : null },
      });
      inducedByCode[d.code] = s;
    }

    // Mapping opération → prestations induites obligatoires/conditionnelles
    for (const rule of operationInducedRuleDefs) {
      for (const code of rule.mandatory) {
        await prisma.operationInducedRule.upsert({
          where: { tenantId_operationType_inducedServiceId: { tenantId: tenant.id, operationType: rule.operationType, inducedServiceId: inducedByCode[code].id } },
          create: { tenantId: tenant.id, operationType: rule.operationType, inducedServiceId: inducedByCode[code].id, mandatory: true },
          update: { mandatory: true, when: null },
        });
      }
      for (const c of rule.conditional) {
        await prisma.operationInducedRule.upsert({
          where: { tenantId_operationType_inducedServiceId: { tenantId: tenant.id, operationType: rule.operationType, inducedServiceId: inducedByCode[c.code].id } },
          create: { tenantId: tenant.id, operationType: rule.operationType, inducedServiceId: inducedByCode[c.code].id, mandatory: false, when: c.when },
          update: { mandatory: false, when: c.when },
        });
      }
    }
  }
  // Zone WH-DAKAR-VILLE aussi
  for (const d of zonesDefs)
    await prisma.storageZone.upsert({ where: { yardId_code: { yardId: dmtWarehouse.id, code: d.code } }, create: { tenantId: dmt.id, yardId: dmtWarehouse.id, ...d }, update: d });
  console.log('✓ Référentiels : régimes, types expédition, colis, zones');
  console.log('✓ Tarification : grille tarifaire, prestations induites, mapping par opération');

  // ── 6. MODULES TENANT ─────────────────────────────────────────────────────
  const moduleDefs: Record<string, string[]> = {
    [dmt.id]:    ['WMS', 'YMS', 'TMS', 'Admin'],
    [fracht.id]: ['WMS', 'TMS'],
    [mota.id]:   ['WMS'],
  };
  for (const [tenantId, codes] of Object.entries(moduleDefs)) {
    for (const code of codes) {
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleCode: { tenantId, moduleCode: code } },
        update: { isActive: true },
        create: { tenantId, moduleCode: code, isActive: true },
      });
    }
  }
  console.log('✓ Modules : DMT (WMS+YMS+TMS+Admin), Fracht (WMS+TMS), MOTA (WMS)');

  // ── 7. DOSSIERS WMS — données réalistes ───────────────────────────────────
  // Nettoyage dans l'ordre des contraintes FK
  await prisma.exitMovementLine.deleteMany({ where: { shipmentLine: { shipmentFile: { tenantId: dmt.id } } } });
  await prisma.exitMovement.deleteMany({ where: { shipmentFile: { tenantId: dmt.id } } });
  await prisma.shipmentLine.deleteMany({ where: { shipmentFile: { tenantId: dmt.id } } });
  await prisma.shipmentFile.deleteMany({ where: { tenantId: dmt.id } });
  console.log('  → Anciennes données WMS DMT supprimées');

  // Zones ICD pour associer les lignes
  const zoneA   = await prisma.storageZone.findFirst({ where: { yardId: dmtYard.id,     code: 'ZONE-A'   } });
  const zoneB   = await prisma.storageZone.findFirst({ where: { yardId: dmtYard.id,     code: 'ZONE-B'   } });
  const zoneC   = await prisma.storageZone.findFirst({ where: { yardId: dmtYard.id,     code: 'ZONE-C'   } });
  const zoneDmtWh = await prisma.storageZone.findFirst({ where: { yardId: dmtWarehouse.id, code: 'ZONE-A' } });

  // Helper pour créer des lignes avec tenantId dénormalisé
  const mkLine = (overrides: Record<string, any>) => ({ tenantId: dmt.id, ...overrides });

  // ─────────────────────────────────────────────────────────────────────────
  // FRACHT — 6 dossiers : 3 EF, 2 MAD, 1 LIBRE
  // ─────────────────────────────────────────────────────────────────────────

  // EF-1 : Sommier OK — en stock complet
  const ef1 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'MSC-2026-041', clientRef: 'FRC-REF-001',
    invoiceNumber: 'INV-FRC-2026-041', transportDocNumber: 'MSCB26041DKR',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'ENTREPOT_FICTIF',
    customsDeclNumber: 'DKR-EF-2026-0041', customsDeclDate: daysAgo(45),
    sommierExpiryDate: daysFrom(320), // OK, 320j restants
    eta: daysAgo(50), entryDate: daysAgo(47),
    status: 'IN_STOCK', defaultYardId: dmtYard.id,
    notes: 'Marchandises générales — équipements industriels',
    createdAt: daysAgo(47),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: ef1.id, packageRef: 'PKG-FRC-001-A', packageTypeCode: 'PALLET', quantity: 10, packageCount: 10, weightKg: 2800, volumeM3: 18.5, surfaceM2: 24, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: ef1.id, packageRef: 'PKG-FRC-001-B', packageTypeCode: 'BOX',    quantity: 24, packageCount: 24, weightKg: 960,  volumeM3: 4.8,  surfaceM2: 8,  status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: ef1.id, packageRef: 'PKG-FRC-001-C', packageTypeCode: 'BOX',    quantity: 12, packageCount: 12, weightKg: 480,  volumeM3: 2.4,  surfaceM2: 4,  status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneB?.id }),
  ]});

  // EF-2 : Sommier bientôt expiré (< 30j), sortie partielle
  const ef2 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'CMA-2025-288', clientRef: 'FRC-REF-002',
    invoiceNumber: 'INV-FRC-2025-288', transportDocNumber: 'CMAB25288DKR',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'ENTREPOT_FICTIF',
    customsDeclNumber: 'DKR-EF-2025-0288', customsDeclDate: daysAgo(340),
    sommierExpiryDate: daysFrom(25), // < 30j → alerte J-30
    eta: daysAgo(345), entryDate: daysAgo(342),
    status: 'PARTIAL_OUT', defaultYardId: dmtYard.id,
    notes: 'Sortie partielle effectuée en janvier — urgent régulariser',
    createdAt: daysAgo(342),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: ef2.id, packageRef: 'PKG-FRC-002-A', packageTypeCode: 'PALLET', quantity: 8,  packageCount: 8,  weightKg: 3200, volumeM3: 16, surfaceM2: 20, status: 'OUT',      yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: ef2.id, packageRef: 'PKG-FRC-002-B', packageTypeCode: 'PALLET', quantity: 6,  packageCount: 6,  weightKg: 2400, volumeM3: 12, surfaceM2: 15, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: ef2.id, packageRef: 'PKG-FRC-002-C', packageTypeCode: 'BOX',    quantity: 30, packageCount: 30, weightKg: 1200, volumeM3: 6,  surfaceM2: 10, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneB?.id }),
  ]});

  // EF-3 : Sommier EXPIRÉ → BLOCKED
  const ef3 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'MSC-2025-112', clientRef: 'FRC-REF-003',
    invoiceNumber: 'INV-FRC-2025-112', transportDocNumber: 'MSCB25112DKR',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'ENTREPOT_FICTIF',
    customsDeclNumber: 'DKR-EF-2025-0112', customsDeclDate: daysAgo(380),
    sommierExpiryDate: daysAgo(15), // EXPIRÉ depuis 15j
    eta: daysAgo(385), entryDate: daysAgo(382),
    status: 'BLOCKED', defaultYardId: dmtYard.id,
    notes: 'Sommier expiré — en attente de régularisation douanière',
    createdAt: daysAgo(382),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: ef3.id, packageRef: 'PKG-FRC-003-A', packageTypeCode: 'WOODEN_BOX', quantity: 4, packageCount: 4, weightKg: 5600, volumeM3: 22, surfaceM2: 30, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneC?.id }),
    mkLine({ shipmentFileId: ef3.id, packageRef: 'PKG-FRC-003-B', packageTypeCode: 'PALLET',     quantity: 6, packageCount: 6, weightKg: 2100, volumeM3: 9,  surfaceM2: 12, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneC?.id }),
  ]});

  // MAD-1 : En stock (arrivée aérienne)
  const mad1 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'AIR-DKR-2026-018', clientRef: 'FRC-AIR-018',
    invoiceNumber: 'INV-FRC-AIR-018', transportDocNumber: 'LTA-DKR26018',
    shipmentTypeCode: 'AIR', storageRegimeCode: 'MAD',
    eta: daysAgo(12), entryDate: daysAgo(10),
    status: 'IN_STOCK', defaultYardId: dmtWarehouse.id,
    createdAt: daysAgo(10),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: mad1.id, packageRef: 'PKG-MAD-A', packageTypeCode: 'BOX', quantity: 40, packageCount: 40, weightKg: 800, volumeM3: 3.2, surfaceM2: 5, status: 'IN_STOCK', yardId: dmtWarehouse.id, zoneId: zoneDmtWh?.id }),
    mkLine({ shipmentFileId: mad1.id, packageRef: 'PKG-MAD-B', packageTypeCode: 'BOX', quantity: 20, packageCount: 20, weightKg: 400, volumeM3: 1.6, surfaceM2: 3, status: 'IN_STOCK', yardId: dmtWarehouse.id, zoneId: zoneDmtWh?.id }),
  ]});

  // MAD-2 : Fully out — soldé (routier)
  const mad2 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'ROAD-2026-007', clientRef: 'FRC-ROAD-007',
    invoiceNumber: 'INV-FRC-ROAD-007', transportDocNumber: 'CMR-FRC-007',
    shipmentTypeCode: 'ROAD', storageRegimeCode: 'MAD',
    eta: daysAgo(35), entryDate: daysAgo(33),
    status: 'FULLY_OUT', defaultYardId: dmtYard.id,
    createdAt: daysAgo(33),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: mad2.id, packageRef: 'PKG-ROAD-A', packageTypeCode: 'PALLET', quantity: 15, packageCount: 15, weightKg: 4500, volumeM3: 22.5, surfaceM2: 30, status: 'OUT', yardId: dmtYard.id, zoneId: zoneB?.id }),
    mkLine({ shipmentFileId: mad2.id, packageRef: 'PKG-ROAD-B', packageTypeCode: 'PALLET', quantity: 10, packageCount: 10, weightKg: 3000, volumeM3: 15,   surfaceM2: 20, status: 'OUT', yardId: dmtYard.id, zoneId: zoneB?.id }),
  ]});

  // LIBRE-1 : En stock (véhicules)
  const lib1 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: fracht.id,
    voyageCode: 'SEA-DKR-2026-033', clientRef: 'FRC-LIBRE-033',
    invoiceNumber: 'INV-FRC-2026-033', transportDocNumber: 'BL-DKR26033',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'WAREHOUSE_LIBRE',
    eta: daysAgo(8), entryDate: daysAgo(6),
    status: 'IN_STOCK', defaultYardId: dmtYard.id,
    createdAt: daysAgo(6),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: lib1.id, packageRef: 'PKG-LIB-A', packageTypeCode: 'VEHICLE',    quantity: 3, packageCount: 3, weightKg: 12000, volumeM3: 30, surfaceM2: 45, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneC?.id }),
    mkLine({ shipmentFileId: lib1.id, packageRef: 'PKG-LIB-B', packageTypeCode: 'WOODEN_BOX', quantity: 2, packageCount: 2, weightKg: 800,   volumeM3: 4,  surfaceM2: 6,  status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneC?.id }),
  ]});

  // ─────────────────────────────────────────────────────────────────────────
  // MOTA — 3 dossiers
  // ─────────────────────────────────────────────────────────────────────────

  // MAD MOTA-1 : En stock (matières premières)
  const motaMad1 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: mota.id,
    voyageCode: 'MOTA-SEA-2026-011', clientRef: 'MOT-REF-011',
    invoiceNumber: 'INV-MOT-2026-011', transportDocNumber: 'BL-MOT26011',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'MAD',
    eta: daysAgo(20), entryDate: daysAgo(18),
    status: 'IN_STOCK', defaultYardId: dmtYard.id,
    createdAt: daysAgo(18),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: motaMad1.id, packageRef: 'PKG-MOT-001-A', packageTypeCode: 'PALLET', quantity: 20, packageCount: 20, weightKg: 7000, volumeM3: 35, surfaceM2: 50, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneB?.id }),
    mkLine({ shipmentFileId: motaMad1.id, packageRef: 'PKG-MOT-001-B', packageTypeCode: 'BOX',    quantity: 50, packageCount: 50, weightKg: 1500, volumeM3: 7,  surfaceM2: 12, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneB?.id }),
  ]});

  // EF MOTA-2 : Sortie partielle, sommier OK
  const motaEf2 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: mota.id,
    voyageCode: 'MOTA-SEA-2026-004', clientRef: 'MOT-REF-004',
    invoiceNumber: 'INV-MOT-2026-004', transportDocNumber: 'BL-MOT26004',
    shipmentTypeCode: 'SEA', storageRegimeCode: 'ENTREPOT_FICTIF',
    customsDeclNumber: 'DKR-EF-2026-0004', customsDeclDate: daysAgo(60),
    sommierExpiryDate: daysFrom(305),
    eta: daysAgo(65), entryDate: daysAgo(62),
    status: 'PARTIAL_OUT', defaultYardId: dmtYard.id,
    createdAt: daysAgo(62),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: motaEf2.id, packageRef: 'PKG-MOT-004-A', packageTypeCode: 'PALLET', quantity: 12, packageCount: 12, weightKg: 4200, volumeM3: 21, surfaceM2: 28, status: 'OUT',      yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: motaEf2.id, packageRef: 'PKG-MOT-004-B', packageTypeCode: 'PALLET', quantity: 8,  packageCount: 8,  weightKg: 2800, volumeM3: 14, surfaceM2: 18, status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneA?.id }),
    mkLine({ shipmentFileId: motaEf2.id, packageRef: 'PKG-MOT-004-C', packageTypeCode: 'BOX',    quantity: 25, packageCount: 25, weightKg: 750,  volumeM3: 3,  surfaceM2: 5,  status: 'IN_STOCK', yardId: dmtYard.id, zoneId: zoneA?.id }),
  ]});

  // LIBRE MOTA-3 : En attente mise en place (arrivée aérienne récente)
  const motaLib3 = await prisma.shipmentFile.create({ data: {
    tenantId: dmt.id, clientId: mota.id,
    voyageCode: 'MOTA-AIR-2026-021', clientRef: 'MOT-AIR-021',
    invoiceNumber: 'INV-MOT-AIR-021',
    shipmentTypeCode: 'AIR', storageRegimeCode: 'WAREHOUSE_LIBRE',
    eta: daysAgo(2), entryDate: daysAgo(1),
    status: 'PENDING_PUTAWAY', defaultYardId: dmtWarehouse.id,
    driverName: 'Ibrahima Fall', truckPlate: 'DK-4821-A',
    createdAt: daysAgo(1),
  }});
  await prisma.shipmentLine.createMany({ data: [
    mkLine({ shipmentFileId: motaLib3.id, packageRef: 'PKG-AIR-A', packageTypeCode: 'BOX', quantity: 8,  packageCount: 8,  weightKg: 240, volumeM3: 0.96, surfaceM2: 2, status: 'IN_STOCK' }),
    mkLine({ shipmentFileId: motaLib3.id, packageRef: 'PKG-AIR-B', packageTypeCode: 'BOX', quantity: 12, packageCount: 12, weightKg: 360, volumeM3: 1.44, surfaceM2: 3, status: 'IN_STOCK' }),
  ]});

  console.log('✓ Dossiers WMS : 9 dossiers (6 Fracht + 3 MOTA) avec lignes colis');

  // ── 8. BONS DE SORTIE ──────────────────────────────────────────────────────

  // Exit 1 : Gate-out effectué (MAD-2 ROAD soldé)
  const mad2Lines = await prisma.shipmentLine.findMany({ where: { shipmentFileId: mad2.id } });
  await prisma.exitMovement.create({ data: {
    tenantId: dmt.id,
    shipmentFileId: mad2.id,
    exitVoyageCode: 'OUT-ROAD-007',
    exitShipmentTypeCode: 'ROAD', exitTransportDoc: 'CMR-OUT-007',
    exitDate: daysAgo(5), deliveryOrderRef: 'DO-FRC-007',
    truckPlate: 'DK-3842-B', driverName: 'Moussa Diallo', driverPhone: '+221776543210',
    status: 'CONFIRMED', gateOutAt: daysAgo(5),
    notes: 'Livraison complète effectuée',
    createdAt: daysAgo(6),
    exitLines: {
      create: mad2Lines.map((l: any) => ({ shipmentLineId: l.id, quantityOut: l.quantity })),
    },
  }});

  // Exit 2 : Confirmé, en attente gate-out (EF-1, sortie partielle lot A)
  const ef1Lines = await prisma.shipmentLine.findMany({ where: { shipmentFileId: ef1.id } });
  await prisma.exitMovement.create({ data: {
    tenantId: dmt.id,
    shipmentFileId: ef1.id,
    exitVoyageCode: 'OUT-MSC-041-A', exitCustomsDecl: 'DKR-SORT-2026-041',
    exitShipmentTypeCode: 'SEA', exitTransportDoc: 'BL-OUT-041',
    exitDate: daysAgo(1), deliveryOrderRef: 'DO-FRC-041-A',
    truckPlate: 'DK-7751-C', driverName: 'Abdou Ndiaye',
    status: 'CONFIRMED', gateOutAt: null,
    createdAt: daysAgo(2),
    exitLines: {
      create: [{ shipmentLineId: ef1Lines[0].id, quantityOut: 5, note: 'Sortie partielle lot A' }],
    },
  }});

  // Exit 3 : Brouillon (MOTA EF-2, en préparation)
  const motaEf2Lines = await prisma.shipmentLine.findMany({ where: { shipmentFileId: motaEf2.id, status: 'IN_STOCK' } });
  await prisma.exitMovement.create({ data: {
    tenantId: dmt.id,
    shipmentFileId: motaEf2.id,
    exitShipmentTypeCode: 'SEA',
    exitDate: daysFrom(3), deliveryOrderRef: 'DO-MOT-004-B',
    status: 'DRAFT',
    createdAt: daysAgo(1),
    exitLines: {
      create: motaEf2Lines.map((l: any) => ({ shipmentLineId: l.id, quantityOut: l.quantity })),
    },
  }});

  console.log('✓ Bons de sortie : 1 gate-out effectué, 1 confirmé (en attente gate), 1 brouillon');
  console.log('\n✅ Seed terminé avec succès !\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Comptes de test (mot de passe : Admin@2026!)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Super Admin  → super@solution-plus.es  (accès SUPER_ADMIN)');
  console.log('  Admin DMT    → admin@dmt.sn            (WMS+YMS+TMS+Admin)');
  console.log('  Agent DMT    → k.benali@dmt.sn         (WMS+YMS+TMS)');
  console.log('  Douane DMT   → douane@dmt.sn           (WMS+YMS+TMS)');
  console.log('  Admin Fracht → admin@fracht-sn.com     (WMS+TMS)');
  console.log('  Admin MOTA   → admin@mota-sn.com       (WMS)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Données WMS créées :');
  console.log('  6 dossiers Fracht : 3 EF (OK/alerte/expiré), 2 MAD, 1 LIBRE');
  console.log('  3 dossiers MOTA   : MAD (stock), EF (partiel), LIBRE (putaway)');
  console.log('  3 bons de sortie  : 1 gate-out, 1 confirmé, 1 brouillon');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
