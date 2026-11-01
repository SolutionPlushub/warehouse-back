import { OperationType } from '@prisma/client';

/**
 * `mandatory: true` = tarif appliqué AUTOMATIQUEMENT aux dossiers dont une
 * opération figure dans applicableOps (voir induced-services/grid-resolver.ts) ;
 * les autres restent ajoutables à la main. Modifiable dans Billing › Grille.
 *
 * Grille tarifaire unique DMT 2026 — source :
 * « DMT - Grille Tarifaire Unique 2026 » (PDF du 28/09/2026, validité 31/12/2026).
 * applicableOps vide = toutes les opérations (équivalent '*' côté UI).
 */
export type DmtTariffDef = {
  code: string;
  domain: string;
  label: string;
  unit: string;
  rate: number;
  sortOrder: number;
  applicableOps: OperationType[];
  mandatory?: boolean;
};

const DEP_TRANS: OperationType[] = ['DEP_TRANS'];
const DEP_STOCK: OperationType[] = ['DEP_STOCK'];
const ICD_FULL: OperationType[] = ['ICD_FULL'];
const ICD_EMPTY: OperationType[] = ['ICD_EMPTY'];
const ICD_OUT: OperationType[] = ['ICD_OUT'];
const ENT_IN: OperationType[] = ['ENT_IN'];
const ENT_OUT: OperationType[] = ['ENT_OUT'];

export const DMT_TARIFF_DEFS: DmtTariffDef[] = [
  // 1. Dépotage transit / transbordement (conventionnel — manutention manuelle)
  { code: 'T-DEP-01', domain: 'Opérations', label: "Dépotage forfaitaire 20' (transit / transbordement)", unit: 'conteneur', rate: 105000, sortOrder: 0,  applicableOps: DEP_TRANS , mandatory: true },
  { code: 'T-DEP-02', domain: 'Opérations', label: "Dépotage forfaitaire 40' (transit / transbordement)", unit: 'conteneur', rate: 135000, sortOrder: 1,  applicableOps: DEP_TRANS , mandatory: true },

  // 2. Dépotage transit / transbordement (cargo lourd — chariot / reach stacker)
  { code: 'T-DEP-03', domain: 'Opérations', label: "Dépotage / relevage 20' (cargo lourd)", unit: 'conteneur', rate: 115000, sortOrder: 2,  applicableOps: DEP_TRANS },
  { code: 'T-DEP-04', domain: 'Opérations', label: "Dépotage / relevage 40' (cargo lourd)", unit: 'conteneur', rate: 155000, sortOrder: 3,  applicableOps: DEP_TRANS },
  { code: 'T-DEP-05', domain: 'Opérations', label: 'Forfait utilisation chariot 3 t',    unit: 'conteneur', rate: 20000,  sortOrder: 4,  applicableOps: DEP_TRANS },
  { code: 'T-DEP-08', domain: 'Opérations', label: 'Forfait utilisation chariot 7 t',    unit: 'conteneur', rate: 40000,  sortOrder: 5,  applicableOps: DEP_TRANS },
  { code: 'T-DEP-09', domain: 'Opérations', label: 'Forfait utilisation chariot 12 t',   unit: 'conteneur', rate: 60000,  sortOrder: 6,  applicableOps: DEP_TRANS },

  // 3. Dépotage transit / transbordement spécial FR/OT
  { code: 'T-DEP-06', domain: 'Opérations', label: "Dépotage Flat Rack / Open Top 20'", unit: 'conteneur', rate: 230000, sortOrder: 7,  applicableOps: DEP_TRANS },
  { code: 'T-DEP-07', domain: 'Opérations', label: "Dépotage Flat Rack / Open Top 40'", unit: 'conteneur', rate: 300000, sortOrder: 8,  applicableOps: DEP_TRANS },

  // 4. Dépotage et mise en entrepôt transit
  { code: 'T-TRN-01', domain: 'Opérations', label: "Dépotage forfaitaire 20' (entrepôt transit)",     unit: 'conteneur',     rate: 105000, sortOrder: 9,  applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-TRN-02', domain: 'Opérations', label: "Dépotage forfaitaire 40' (entrepôt transit)",     unit: 'conteneur',     rate: 135000, sortOrder: 10, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-TRN-03', domain: 'Opérations', label: "Manutention entrepôt in/out 20' (transit)",       unit: 'conteneur',     rate: 60000,  sortOrder: 11, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-TRN-04', domain: 'Opérations', label: "Manutention entrepôt in/out 40' (transit)",       unit: 'conteneur',     rate: 100000, sortOrder: 12, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-TRN-05', domain: 'Opérations', label: 'Chargement sur camion (entrepôt transit)',        unit: 'camion',        rate: 115000, sortOrder: 13, applicableOps: [...DEP_STOCK, ...ENT_OUT] },
  { code: 'T-TRN-06', domain: 'Entrepôt',   label: "Stockage cargo en transit 20'",                   unit: 'conteneur·jour', rate: 6500,   sortOrder: 14, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-TRN-07', domain: 'Entrepôt',   label: "Stockage cargo en transit 40'",                   unit: 'conteneur·jour', rate: 11000,  sortOrder: 15, applicableOps: DEP_STOCK , mandatory: true },

  // 5. Dépotage et mise en entrepôt local
  { code: 'T-LOC-01', domain: 'Opérations', label: "Dépotage 20' (entrepôt local)",                   unit: 'conteneur', rate: 75000,  sortOrder: 16, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-LOC-02', domain: 'Opérations', label: "Dépotage 40' (entrepôt local)",                   unit: 'conteneur', rate: 150000, sortOrder: 17, applicableOps: DEP_STOCK , mandatory: true },
  { code: 'T-LOC-03', domain: 'Opérations', label: "Double relevage 20' (entrepôt local)",            unit: 'conteneur', rate: 30000,  sortOrder: 18, applicableOps: DEP_STOCK },
  { code: 'T-LOC-04', domain: 'Opérations', label: "Double relevage 40' (entrepôt local)",            unit: 'conteneur', rate: 60000,  sortOrder: 19, applicableOps: DEP_STOCK },
  { code: 'T-LOC-05', domain: 'Opérations', label: "Manutention entrepôt in/out 20' (local)",         unit: 'conteneur', rate: 150000, sortOrder: 20, applicableOps: [...DEP_STOCK, ...ENT_IN, ...ENT_OUT] , mandatory: true },
  { code: 'T-LOC-06', domain: 'Opérations', label: "Manutention entrepôt in/out 40' (local)",         unit: 'conteneur', rate: 300000, sortOrder: 21, applicableOps: [...DEP_STOCK, ...ENT_IN, ...ENT_OUT] , mandatory: true },
  { code: 'T-LOC-07', domain: 'Opérations', label: 'Déchargement / chargement camion',               unit: 'camion',    rate: 115000, sortOrder: 22, applicableOps: [...DEP_STOCK, ...ENT_IN, ...ENT_OUT] , mandatory: true },

  // 6. Stockage warehouse (entrepôt couvert)
  { code: 'T-WH-01',  domain: 'Entrepôt',   label: 'Stockage warehouse journalier (1–30 j)',         unit: 'm²·jour',   rate: 350,    sortOrder: 23, applicableOps: ENT_IN , mandatory: true },
  { code: 'T-WH-02',  domain: 'Entrepôt',   label: 'Stockage warehouse mensuel (31 j +)',            unit: 'm²·mois',   rate: 5000,   sortOrder: 24, applicableOps: ENT_IN , mandatory: true },
  { code: 'T-WH-03',  domain: 'Entrepôt',   label: 'Majoration entrepôt sous-douane (fictif)',       unit: '% du tarif', rate: 20,     sortOrder: 25, applicableOps: ENT_IN },
  { code: 'T-WH-04',  domain: 'Entrepôt',   label: 'Stockage entrepôt fictif journalier (1–30 j)',   unit: 'm²·jour',   rate: 420,    sortOrder: 26, applicableOps: ENT_IN , mandatory: true },
  { code: 'T-WH-05',  domain: 'Entrepôt',   label: 'Stockage entrepôt fictif mensuel (31 j +)',      unit: 'm²·mois',   rate: 6000,   sortOrder: 27, applicableOps: ENT_IN , mandatory: true },

  // 7. Stockage yard — conteneurs vides et pleins
  { code: 'T-YRD-01', domain: 'ICD',        label: 'Stockage yard journalier — conteneur vide',      unit: 'EVP·jour',  rate: 1500,   sortOrder: 28, applicableOps: ICD_EMPTY , mandatory: true },
  { code: 'T-YRD-02', domain: 'ICD',        label: 'Stockage yard journalier — conteneur plein',     unit: 'EVP·jour',  rate: 10000,  sortOrder: 29, applicableOps: ICD_FULL , mandatory: true },
  { code: 'T-YRD-03', domain: 'ICD',        label: 'Stockage yard mensuel — conteneur vide',         unit: 'EVP·mois',  rate: 45000,  sortOrder: 30, applicableOps: ICD_EMPTY , mandatory: true },
  { code: 'T-YRD-04', domain: 'ICD',        label: 'Stockage yard mensuel — conteneur plein',        unit: 'EVP·mois',  rate: 300000, sortOrder: 31, applicableOps: ICD_FULL , mandatory: true },
  { code: 'T-YRD-05', domain: 'ICD',        label: 'Double relevage — conteneur vide',               unit: 'EVP',       rate: 10000,  sortOrder: 32, applicableOps: [...ICD_EMPTY, ...ICD_OUT] , mandatory: true },
  { code: 'T-YRD-06', domain: 'ICD',        label: 'Double relevage — conteneur plein',              unit: 'EVP',       rate: 30000,  sortOrder: 33, applicableOps: [...ICD_FULL, ...ICD_OUT] , mandatory: true },

  // 8. Stockage yard MAND — general cargo non conteneurisé
  { code: 'T-MAND-01', domain: 'ICD',       label: 'Stockage yard MAND journalier (cargo non conteneurisé)', unit: 'm²·jour', rate: 200,  sortOrder: 34, applicableOps: [...ENT_IN, ...DEP_STOCK] },
  { code: 'T-MAND-02', domain: 'ICD',       label: 'Stockage yard MAND mensuel (cargo non conteneurisé)',    unit: 'm²·mois', rate: 3500, sortOrder: 35, applicableOps: [...ENT_IN, ...DEP_STOCK] },
];

/** Remap des prestations induites vers la nouvelle grille (codes absents = null). */
export const DMT_INDUCED_TARIFF_CODES: Record<string, string | null> = {
  'IS-05': 'T-YRD-06',
  'IS-06': 'T-YRD-02',
  'IS-07': 'T-DEP-01',
  'IS-08': null,
  'IS-09': 'T-DEP-01',
  'IS-10': null,
  'IS-11': 'T-DEP-02',
  'IS-12': null,
  'IS-13': 'T-DEP-02',
  'IS-14': null,
  'IS-17': 'T-WH-01',
  'IS-18': 'T-LOC-05',
  'IS-19': 'T-LOC-05',
  'IS-20': 'T-LOC-07',
  'IS-21': 'T-LOC-07',
  'IS-23': null,
};
