/**
 * Catalogue de toutes les permissions de la plateforme.
 * Synchronisé en base au démarrage (codes stables). Les profils et les
 * exceptions utilisateur pointent vers ces codes — rien n'est figé dans
 * les contrôleurs au-delà du code requis par chaque route.
 */

export interface PermissionDef {
  code: string;
  module: string;
  action: string;
  label: string;
  description?: string;
  platformOnly?: boolean;
  sortOrder: number;
}

export const MODULE_LABELS: Record<string, string> = {
  admin: 'Administration',
  clients: 'Clients & transporteurs',
  contracts: 'Contrats & conditions',
  site: 'Plan du site',
  dossiers: 'Dossiers',
  workflow: 'Étapes du workflow',
  gate: 'Gate',
  warehouse: 'Entrepôt',
  yard: 'Parc conteneurs',
  depotage: 'Dépotage',
  stuffing: 'Empotage & export',
  customs: 'Douane',
  finance: 'Finance',
  dashboard: 'Tableau de bord',
  reporting: 'Reporting',
  tms: 'Transport (TMS)',
  notifications: 'Notifications',
  portal: 'Portail client',
  wms: 'WMS',
  referentiels: 'Référentiels',
};

let order = 0;
function perm(
  code: string,
  module: string,
  label: string,
  description = '',
  platformOnly = false,
): PermissionDef {
  const action = code.startsWith(`${module}.`) ? code.slice(module.length + 1) : code;
  return {
    code,
    module,
    action,
    label,
    description,
    platformOnly,
    sortOrder: order++,
  };
}

export const PERMISSIONS: PermissionDef[] = [
  perm('admin.users.read', 'admin', 'Voir les utilisateurs'),
  perm('admin.users.manage', 'admin', 'Gérer les utilisateurs', 'Créer, modifier, inviter, désactiver.'),
  perm('admin.roles.read', 'admin', 'Voir les profils et le catalogue'),
  perm('admin.roles.manage', 'admin', 'Gérer les profils', 'Créer des profils et modifier leur matrice.'),
  perm('admin.permissions.assign', 'admin', 'Affecter les droits', 'Profils et exceptions individuelles sur un utilisateur.'),
  perm('admin.branding.manage', 'admin', 'Modifier le branding'),
  perm('admin.settings.read', 'admin', 'Lire le paramétrage', 'Régimes, statuts, workflow, modèles, moteur de séjour.'),
  perm('admin.settings.manage', 'admin', 'Modifier le paramétrage'),
  perm('admin.audit.read', 'admin', 'Consulter le journal d\'audit'),
  perm('admin.tenants.manage', 'admin', 'Gérer les organisations', 'Réservé à la plateforme.', true),

  perm('clients.read', 'clients', 'Voir les clients'),
  perm('clients.manage', 'clients', 'Créer, modifier et supprimer les clients'),
  perm('clients.commercial.read', 'clients', 'Voir les données commerciales client', 'Solde, conditions de paiement, blocage comptable.'),

  perm('contracts.read', 'contracts', 'Voir les contrats'),
  perm('contracts.manage', 'contracts', 'Gérer contrats et conditions'),

  perm('site.plan.read', 'site', 'Voir le plan du site'),
  perm('site.plan.manage', 'site', 'Modifier zones, emplacements et slots'),
  perm('site.yard_config.manage', 'site', 'Configurer le yard'),

  perm('dossiers.read', 'dossiers', 'Lire les dossiers'),
  perm('dossiers.create', 'dossiers', 'Créer un dossier'),
  perm('dossiers.update', 'dossiers', 'Modifier un dossier'),
  perm('dossiers.archive', 'dossiers', 'Archiver ou clôturer un dossier'),
  perm('dossiers.commercial.read', 'dossiers', 'Voir les montants du dossier', 'Tarifs, facture, état du compte. Masqué sinon.'),
  perm('dossiers.validate.entry', 'dossiers', 'Valider le Bon à Entrer'),
  perm('dossiers.validate.exit', 'dossiers', 'Valider le Bon de Sortie'),
  perm('dossiers.validate.removal', 'dossiers', 'Valider le Bon à Enlever'),
  perm('dossiers.validate.finance', 'dossiers', 'Valider la finance avant sortie'),
  perm('dossiers.validate.dex', 'dossiers', 'Validation DEX / déblocage exceptionnel'),

  perm('workflow.prealert.execute', 'workflow', 'Saisir la pré-alerte'),
  perm('workflow.dossier_create.execute', 'workflow', 'Créer le dossier (étape workflow)'),
  perm('workflow.capacity.execute', 'workflow', 'Valider la capacité'),
  perm('workflow.doc_check.execute', 'workflow', 'Contrôle documentaire (exécution)'),
  perm('workflow.doc_check.validate', 'workflow', 'Valider les documents'),
  perm('workflow.gate_in.execute', 'workflow', 'Exécuter le Gate In'),
  perm('workflow.gate_out.execute', 'workflow', 'Exécuter le Gate Out'),
  perm('workflow.ops.execute', 'workflow', 'Exécuter l\'étape opérationnelle'),
  perm('workflow.exit_order.execute', 'workflow', 'Saisir l\'ordre de sortie'),
  perm('workflow.stock_check.execute', 'workflow', 'Vérifier le stock (exécution)'),
  perm('workflow.stock_check.validate', 'workflow', 'Valider la conformité stock'),
  perm('workflow.finance.validate', 'workflow', 'Valider l\'étape finance'),
  perm('workflow.dex.validate', 'workflow', 'Valider l\'étape DEX'),
  perm('workflow.picking.execute', 'workflow', 'Picking, contrôle, chargement'),
  perm('workflow.delivery_note.execute', 'workflow', 'Bordereau de livraison / EIR sortie'),
  perm('workflow.close.execute', 'workflow', 'Clôturer le dossier'),

  perm('gate.read', 'gate', 'Voir le gate'),
  perm('gate.execute', 'gate', 'Exécuter Gate In / Gate Out'),

  perm('warehouse.read', 'warehouse', 'Voir l\'entrepôt'),
  perm('warehouse.execute', 'warehouse', 'Exécuter la réception et la sortie entrepôt'),

  perm('yard.read', 'yard', 'Voir le parc'),
  perm('yard.execute', 'yard', 'Exécuter positionnement, EIR, dépotage parc'),
  perm('yard.containers.read', 'yard', 'Voir les conteneurs'),
  perm('yard.containers.manage', 'yard', 'Mettre à jour les conteneurs'),

  perm('depotage.read', 'depotage', 'Voir le dépotage'),
  perm('depotage.execute', 'depotage', 'Exécuter le dépotage'),

  perm('stuffing.read', 'stuffing', 'Voir l\'empotage / export'),
  perm('stuffing.execute', 'stuffing', 'Exécuter l\'empotage et le chargement export'),

  perm('customs.read', 'customs', 'Voir le suivi douanier'),
  perm('customs.manage', 'customs', 'Saisir déclarations, BAE, MAD'),
  perm('customs.sommiers.read', 'customs', 'Voir les sommiers'),
  perm('customs.sommiers.manage', 'customs', 'Gérer les sommiers'),

  perm('finance.read', 'finance', 'Voir la finance'),
  perm('finance.manage', 'finance', 'Gérer la finance'),
  perm('finance.tariffs.read', 'finance', 'Voir la grille tarifaire'),
  perm('finance.tariffs.manage', 'finance', 'Modifier la grille tarifaire'),
  perm('finance.invoices.read', 'finance', 'Voir les factures'),
  perm('finance.invoices.manage', 'finance', 'Émettre et encaisser les factures'),
  perm('finance.payments.read', 'finance', 'Voir les paiements'),
  perm('finance.payments.manage', 'finance', 'Valider les paiements'),
  perm('finance.induced.read', 'finance', 'Voir les services induits'),
  perm('finance.induced.manage', 'finance', 'Saisir les services induits'),

  perm('dashboard.read', 'dashboard', 'Voir le tableau de bord'),
  perm('reporting.read', 'reporting', 'Voir le reporting'),
  perm('reporting.export', 'reporting', 'Exporter Excel / PDF'),
  perm('reporting.schedule', 'reporting', 'Planifier les rapports', 'Créer, modifier et envoyer les rapports automatiques. Accordée par défaut aux administrateurs, et attribuable à tout autre profil.'),
  perm('reporting.ai', 'reporting', 'Rapports personnalisés IA', 'Interroger l’agent Claude en lecture seule. Accordée par défaut aux administrateurs, et attribuable à tout autre profil.'),

  perm('tms.read', 'tms', 'Voir le transport'),
  perm('tms.manage', 'tms', 'Gérer tournées et affectations'),
  perm('tms.fleet.manage', 'tms', 'Gérer flotte et chauffeurs'),
  perm('tms.shuttle.manage', 'tms', 'Gérer les navettes port'),
  perm('tms.pod.execute', 'tms', 'Saisir les POD'),

  perm('notifications.read', 'notifications', 'Voir les notifications'),
  perm('notifications.send', 'notifications', 'Envoyer une notification'),
  perm('notifications.manage', 'notifications', 'Gérer les modèles'),

  perm('portal.read', 'portal', 'Accéder au portail client'),

  perm('wms.read', 'wms', 'Lire le stock WMS'),
  perm('wms.execute', 'wms', 'Exécuter réception, putaway, sortie WMS'),

  perm('referentiels.read', 'referentiels', 'Lire les référentiels'),
  perm('referentiels.manage', 'referentiels', 'Modifier les référentiels'),
];

export const PLATFORM_PERMISSIONS = PERMISSIONS.filter((p) => p.platformOnly).map((p) => p.code);

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  permissions: string[];
  /** User.role utilisé seulement tant qu'aucun profil n'est affecté. */
  legacyFor?: string;
}

const uniq = (...groups: string[][]) => [...new Set(groups.flat())];

const OPS_GATE = [
  'dossiers.read',
  'gate.read',
  'gate.execute',
  'workflow.gate_in.execute',
  'workflow.gate_out.execute',
  'workflow.doc_check.execute',
  'site.plan.read',
  'yard.containers.read',
  'referentiels.read',
];

const OPS_WAREHOUSE = [
  'dossiers.read',
  'warehouse.read',
  'warehouse.execute',
  'wms.read',
  'wms.execute',
  'workflow.ops.execute',
  'workflow.stock_check.execute',
  'workflow.picking.execute',
  'workflow.delivery_note.execute',
  'site.plan.read',
  'referentiels.read',
];

const OPS_YARD = [
  'dossiers.read',
  'yard.read',
  'yard.execute',
  'yard.containers.read',
  'yard.containers.manage',
  'workflow.ops.execute',
  'workflow.stock_check.execute',
  'workflow.picking.execute',
  'workflow.delivery_note.execute',
  'site.plan.read',
  'referentiels.read',
];

const OPS_DEPOTAGE = [
  'dossiers.read',
  'depotage.read',
  'depotage.execute',
  'workflow.ops.execute',
  'site.plan.read',
  'referentiels.read',
];

const OPS_EXPORT = [
  'dossiers.read',
  'stuffing.read',
  'stuffing.execute',
  'workflow.ops.execute',
  'workflow.picking.execute',
  'customs.read',
  'site.plan.read',
  'referentiels.read',
];

const AGENT_EXTRA = [
  'dashboard.read',
  'dossiers.create',
  'dossiers.update',
  'dossiers.validate.entry',
  'clients.read',
  'customs.read',
  'customs.manage',
  'customs.sommiers.read',
  'tms.read',
  'tms.manage',
  'tms.fleet.manage',
  'tms.shuttle.manage',
  'tms.pod.execute',
  'notifications.read',
  'notifications.send',
  'finance.invoices.read',
  'finance.invoices.manage',
  'finance.induced.read',
  'finance.induced.manage',
  'reporting.read',
  'workflow.prealert.execute',
  'workflow.dossier_create.execute',
  'workflow.capacity.execute',
  'workflow.exit_order.execute',
];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: 'ADMIN',
    name: 'Administrateur',
    description: 'Comptes, profils, paramétrage et audit. Pas d\'exécution opérationnelle.',
    permissions: [
      'admin.users.read',
      'admin.users.manage',
      'admin.roles.read',
      'admin.roles.manage',
      'admin.permissions.assign',
      'admin.branding.manage',
      'admin.settings.read',
      'admin.settings.manage',
      'admin.audit.read',
      'clients.read',
      'clients.manage',
      'clients.commercial.read',
      'referentiels.read',
      'referentiels.manage',
      'reporting.read',
      'reporting.schedule',
      'reporting.ai',
    ],
  },
  {
    code: 'MANAGEMENT',
    name: 'Management',
    description: 'Validations engageantes, clients, tarifs, reporting et plan du site.',
    permissions: [
      'dashboard.read',
      'dossiers.read',
      'dossiers.commercial.read',
      'dossiers.validate.entry',
      'dossiers.validate.exit',
      'dossiers.validate.removal',
      'dossiers.validate.finance',
      'clients.read',
      'clients.manage',
      'clients.commercial.read',
      'contracts.read',
      'contracts.manage',
      'finance.read',
      'finance.tariffs.read',
      'finance.tariffs.manage',
      'finance.invoices.read',
      'finance.payments.read',
      'reporting.read',
      'reporting.export',
      'site.plan.read',
      'site.plan.manage',
      'gate.read',
      'warehouse.read',
      'yard.read',
      'yard.containers.read',
      'depotage.read',
      'stuffing.read',
      'customs.read',
      'notifications.read',
      'workflow.prealert.execute',
      'workflow.exit_order.execute',
      'workflow.finance.validate',
      'workflow.dex.validate',
    ],
  },
  {
    code: 'SUPERVISOR',
    name: 'Superviseur',
    description: 'Création des dossiers, validations, douane et reporting.',
    permissions: [
      'dashboard.read',
      'dossiers.read',
      'dossiers.create',
      'dossiers.update',
      'dossiers.archive',
      'dossiers.validate.entry',
      'dossiers.validate.exit',
      'dossiers.validate.removal',
      'site.plan.read',
      'site.plan.manage',
      'customs.read',
      'customs.manage',
      'customs.sommiers.read',
      'customs.sommiers.manage',
      'reporting.read',
      'reporting.export',
      'clients.read',
      'gate.read',
      'warehouse.read',
      'yard.read',
      'yard.containers.read',
      'notifications.read',
      'referentiels.read',
      'workflow.prealert.execute',
      'workflow.dossier_create.execute',
      'workflow.capacity.execute',
      'workflow.doc_check.validate',
      'workflow.stock_check.validate',
      'workflow.close.execute',
      'workflow.exit_order.execute',
      'workflow.dex.validate',
    ],
  },
  {
    code: 'OPS_GATE',
    name: 'Opérations — Gate',
    description: 'Compte de poste gate@ : entrée et sortie uniquement.',
    permissions: OPS_GATE,
  },
  {
    code: 'OPS_WAREHOUSE',
    name: 'Opérations — Entrepôt',
    description: 'Compte de poste warehouse@ : réception, stock, picking, sortie.',
    permissions: OPS_WAREHOUSE,
  },
  {
    code: 'OPS_YARD',
    name: 'Opérations — Parc',
    description: 'Compte de poste yard@ : slots, positionnement, EIR.',
    permissions: OPS_YARD,
  },
  {
    code: 'OPS_DEPOTAGE',
    name: 'Opérations — Dépotage',
    description: 'Compte de poste depotage@.',
    permissions: OPS_DEPOTAGE,
  },
  {
    code: 'OPS_EXPORT',
    name: 'Opérations — Export',
    description: 'Compte de poste export@ : empotage et chargement.',
    permissions: OPS_EXPORT,
  },
  {
    code: 'CUSTOMS',
    name: 'Douane',
    description: 'Déclarations, BAE, MAD et sommiers.',
    legacyFor: 'CUSTOMS',
    permissions: [
      'dashboard.read',
      'dossiers.read',
      'customs.read',
      'customs.manage',
      'customs.sommiers.read',
      'customs.sommiers.manage',
      'site.plan.read',
      'referentiels.read',
      'reporting.read',
    ],
  },
  {
    code: 'DEX',
    name: 'Direction Exploitation',
    description: 'Validation DEX, bon de sortie et déblocages tracés.',
    legacyFor: 'DEX',
    permissions: [
      'dashboard.read',
      'dossiers.read',
      'dossiers.validate.dex',
      'dossiers.validate.exit',
      'workflow.dex.validate',
      'finance.read',
      'finance.invoices.read',
      'clients.read',
      'reporting.read',
      'site.plan.read',
      'yard.read',
      'gate.read',
      'customs.read',
    ],
  },
  {
    code: 'CLIENT',
    name: 'Client',
    description: 'Portail, suivi de dossier et factures.',
    legacyFor: 'CLIENT',
    permissions: ['portal.read', 'dossiers.read', 'finance.invoices.read'],
  },
  {
    code: 'AGENT',
    name: 'Opérations (historique)',
    description:
      'Filet de compatibilité du rôle AGENT actuel : exécution large, sans administration ni validation DEX. Remplacé dès qu\'un profil de poste est affecté.',
    legacyFor: 'AGENT',
    permissions: uniq(OPS_GATE, OPS_WAREHOUSE, OPS_YARD, OPS_DEPOTAGE, OPS_EXPORT, AGENT_EXTRA),
  },
];

const KNOWN = new Set(PERMISSIONS.map((p) => p.code));

export function assertCatalog(): void {
  for (const role of ROLE_TEMPLATES) {
    for (const code of role.permissions) {
      if (!KNOWN.has(code)) {
        throw new Error(`Profil ${role.code} référence une permission inconnue : ${code}`);
      }
    }
  }
}

/** Droits appliqués tant que l'utilisateur n'a aucun profil affecté. */
export function legacyPermissionCodes(userRole: string, allCodes: string[]): string[] {
  if (userRole === 'SUPER_ADMIN') return allCodes;
  if (userRole === 'ADMIN') {
    return allCodes.filter((c) => !PLATFORM_PERMISSIONS.includes(c));
  }
  const tpl = ROLE_TEMPLATES.find((t) => t.legacyFor === userRole);
  if (!tpl) return [];
  const allowed = new Set(allCodes);
  return tpl.permissions.filter((c) => allowed.has(c));
}
