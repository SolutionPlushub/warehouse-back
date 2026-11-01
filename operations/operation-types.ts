import { OperationType, OperationStatus } from '@prisma/client';

// Miroir strict de OP_TYPES (lib/data/data-dos.js côté frontend export-nextjs-2)
// et de la section OPÉRATIONS ET PIPELINE dans claude.md — garder synchronisé
// des deux côtés. Le code FP-* correspondant est indiqué en commentaire.

export type OperationInputRequirement =
  | 'lines_in_stock'
  | 'container_in_yard'
  | null;

interface OperationTypeCfg {
  requiresInput: OperationInputRequirement;
  initialStatus: OperationStatus;
  // Pipeline d'étapes métier de ce type d'opération — miroir de
  // OP_TYPES[].steps côté frontend (lib/data/data-dos.js), utilisé par
  // OperationsService.advance() (OperationLine.stepIdx).
  steps: string[];
  // IN = opération entrante, OUT = sortante — une opération OUT exige le
  // gating Finance→DEX avant sa dernière étape (règle §15 du cahier des
  // charges, miroir de la garde dans executeOpStep()).
  dir: 'IN' | 'OUT';
}

export const OPERATION_TYPE_CFG: Record<OperationType, OperationTypeCfg> = {
  // FP-ICD-001/002 — Stockage conteneurs pleins/vides : pas de prérequis,
  // le conteneur entre dans le système via cette opération.
  // « Mise à terre » : déchargement du conteneur du camion au sol, avec
  // l'engin de manutention utilisé (migration 20261014120000 — les unités
  // déjà engagées à cette date sautent l'étape).
  ICD_FULL: {
    requiresInput: null,
    initialStatus: OperationStatus.DRAFT,
    dir: 'IN',
    steps: ['Mise à terre', 'Placement & EIR'],
  },
  ICD_EMPTY: {
    requiresInput: null,
    initialStatus: OperationStatus.DRAFT,
    dir: 'IN',
    steps: ['Mise à terre', 'Placement & EIR'],
  },
  // FP-ICD-003 — Sortie de conteneurs : nécessite un conteneur déjà en yard.
  ICD_OUT: {
    requiresInput: 'container_in_yard',
    initialStatus: OperationStatus.DRAFT,
    dir: 'OUT',
    steps: [
      "Ordre d'enlèvement",
      'Validation stock',
      'Validation financière',
      'Validation DEX',
      'Gate In véhicule',
      'Picking et chargement',
      'EIR Sortie',
      'Gate Out',
      'Libération du slot',
    ],
  },
  // FP-ENT-001 — Réception et mise en entrepôt : pas de prérequis, marchandise entrante.
  ENT_IN: {
    requiresInput: null,
    initialStatus: OperationStatus.DRAFT,
    dir: 'IN',
    steps: [
      'Déchargement',
      'Contrôle cargaison (qté & qualité)',
      'Placement & mise en stock',
      'Avis de réception',
    ],
  },
  // FP-ENT-002 — Sortie de marchandises d'entrepôt : nécessite des lignes en stock.
  ENT_OUT: {
    requiresInput: 'lines_in_stock',
    initialStatus: OperationStatus.DRAFT,
    dir: 'OUT',
    steps: [
      'Ordre de sortie',
      'Validation stock',
      'Validation financière',
      'Validation DEX',
      'Picking',
      'Contrôle (qté & qualité)',
      'Chargement',
      'Bon de sortie',
      'Gate Out',
      'Clôture',
    ],
  },
  // FP-DEP-001/002 — Dépotage (transbordement ou mise en stock) : nécessite un conteneur en yard.
  DEP_TRANS: {
    requiresInput: 'container_in_yard',
    initialStatus: OperationStatus.DRAFT,
    dir: 'IN',
    steps: [
      'Réception conteneur',
      'Mise à terre',
      'Contrôle plomb',
      'Ouverture',
      'Déchargement',
      'Contrôle - Pointage',
      'Chargement camion',
      'Rapport dépotage',
      'Sortie camion',
      'Retour conteneur vide',
    ],
  },
  DEP_STOCK: {
    requiresInput: 'container_in_yard',
    initialStatus: OperationStatus.DRAFT,
    dir: 'IN',
    steps: [
      'Réception conteneur',
      'Mise à terre',
      'Contrôle plomb',
      'Dépotage',
      'Pointage',
      'Contrôle qualité',
      'Création réception entrepôt',
      'Placement & mise en stock',
      'Retour conteneur vide',
    ],
  },
  // FP-EMP-001/002 — Empotage / chargement export : nécessite des lignes en stock.
  EMP_EXPORT: {
    requiresInput: 'lines_in_stock',
    initialStatus: OperationStatus.DRAFT,
    dir: 'OUT',
    steps: [
      "Ordre d'empotage",
      'Réservation / Réception conteneur vide',
      'Picking marchandise',
      'Acheminement zone empotage',
      'Chargement',
      'Contrôle final',
      'Scellage',
      'Émission EIR',
      'Gate Out',
    ],
  },
  LOAD_EXPORT: {
    requiresInput: 'lines_in_stock',
    initialStatus: OperationStatus.DRAFT,
    dir: 'OUT',
    steps: [
      'Ordre de chargement',
      'Picking / réception marchandise',
      'Contrôle qualité',
      'Acheminement',
      'Chargement',
      'Rapport de chargement',
      'Gate Out',
    ],
  },
};

/**
 * Nature (`kind`) attendue d'une étape d'après son libellé — miroir EXACT
 * de stepKindOf() côté frontend (op-procedures.jsx). Le serveur l'utilise
 * pour refuser un envoi dont le type ne correspond pas à l'étape en cours
 * (ex. « scellage » envoyé à l'étape « Mise à terre »).
 */
export function stepKindOf(label: string): string {
  const l = (label || '').toLowerCase();
  if (/mise à terre/.test(l)) return 'grounding';
  if (/placement/.test(l)) return 'placement';
  if (/picking et chargement/.test(l)) return 'load';
  if (/affectation emplacement/.test(l)) return 'slot';
  if (/positionnement/.test(l)) return 'position';
  if (/contrôle plomb/.test(l)) return 'seal';
  if (/scellage/.test(l)) return 'sealing';
  if (/eir/.test(l)) return 'eir';
  if (/ouverture/.test(l)) return 'open';
  if (/rapport/.test(l)) return 'report';
  if (/réservation/.test(l)) return 'reserve';
  if (/réception conteneur/.test(l)) return 'recvct';
  if (/ordre (de sortie|d'enlèvement|d'empotage|de chargement)/.test(l))
    return 'order';
  if (/validation stock/.test(l)) return 'stockcheck';
  if (/validation financière/.test(l)) return 'finance';
  if (/validation dex/.test(l)) return 'dex';
  if (/gate in/.test(l)) return 'gatein';
  if (/retour conteneur vide/.test(l)) return 'emptyreturn';
  if (/gate out|sortie camion|sortie du conteneur/.test(l)) return 'gateout';
  if (/libération du slot/.test(l)) return 'release';
  if (/picking|prélèvement/.test(l)) return 'picking';
  if (/pointage/.test(l)) return 'tally';
  if (/déchargement|dépotage/.test(l)) return 'unload';
  if (/contrôle (qualité|final|cargaison)|contrôle \(/.test(l)) return 'quality';
  if (/chargement camion|transbordement/.test(l)) return 'transship';
  if (/chargement/.test(l)) return 'load';
  if (/mise en stock/.test(l)) return 'store';
  if (/création réception entrepôt/.test(l)) return 'whreception';
  if (/avis de réception|bon de sortie/.test(l)) return 'doc';
  if (/facturation/.test(l)) return 'billing';
  if (/acheminement/.test(l)) return 'move';
  if (/clôture/.test(l)) return 'close';
  return 'confirm';
}
