/**
 * Permission exigée par chaque contrôleur.
 * Une route listée ici est autorisée par les droits effectifs (profils +
 * exceptions), plus par le rôle enum historique. Plusieurs codes = OU.
 * `authenticated` = tout utilisateur connecté.
 */

export type PermissionSpec = string | string[];

export interface ControllerAccess {
  read?: PermissionSpec;
  write?: PermissionSpec;
  handlers?: Record<string, PermissionSpec>;
}

const any = (...codes: string[]): string[] => codes;

export const ENDPOINT_ACCESS: Record<string, ControllerAccess> = {
  UsersController: {
    read: 'admin.users.read',
    write: 'admin.users.manage',
    handlers: { setMyDefaultYard: 'authenticated' },
  },
  AccessControlController: {
    read: 'admin.roles.read',
    write: 'admin.roles.manage',
    handlers: {
      getUserAccess: 'admin.permissions.assign',
      setUserAccess: 'admin.permissions.assign',
      me: 'authenticated',
    },
  },
  TenantsController: {
    read: 'admin.tenants.manage',
    write: 'admin.tenants.manage',
    handlers: {
      findOne: any('admin.tenants.manage', 'admin.branding.manage', 'clients.read'),
      updateBranding: 'admin.branding.manage',
      create: any('admin.tenants.manage', 'clients.manage'),
      toggle: any('admin.tenants.manage', 'clients.manage'),
      removeClient: any('admin.tenants.manage', 'clients.manage'),
      updateClientProfile: 'clients.manage',
      getMyModules: 'authenticated',
      getModules: 'admin.settings.read',
      updateModules: 'admin.settings.manage',
      toggleModule: 'admin.settings.manage',
    },
  },
  WmsController: {
    read: any('dossiers.read', 'wms.read'),
    write: any('dossiers.update', 'wms.execute', 'warehouse.execute'),
    handlers: {
      getDashboard: 'dashboard.read',
      updateCargoContainer: any('dossiers.update', 'dossiers.validate.dex'),
      listClients: 'clients.read',
      getClient: 'clients.read',
      createClient: 'clients.manage',
      updateClient: 'clients.manage',
      deleteClient: 'clients.manage',
      createAllocation: 'clients.manage',
      updateAllocation: 'clients.manage',
      deleteAllocation: 'clients.manage',
      listFiles: any(
        'dossiers.read',
        'wms.read',
        'customs.read',
        'customs.sommiers.read',
        'depotage.read',
        'stuffing.read',
      ),
      getFile: any('dossiers.read', 'wms.read', 'customs.read', 'customs.sommiers.read'),
      listLines: any('dossiers.read', 'wms.read', 'warehouse.read', 'depotage.read', 'stuffing.read'),
      listExitMovements: any('dossiers.read', 'wms.read', 'customs.read', 'customs.sommiers.read'),
      listAllExitMovements: any('dossiers.read', 'customs.read', 'customs.sommiers.read'),
      checkVoyageCode: any('dossiers.read', 'dossiers.create', 'workflow.dossier_create.execute'),
      createFile: any('dossiers.create', 'workflow.dossier_create.execute'),
      deleteFile: 'dossiers.archive',
      createExitMovement: any(
        'dossiers.update',
        'wms.execute',
        'warehouse.execute',
        'workflow.exit_order.execute',
        'dossiers.validate.exit',
      ),
      confirmExitMovement: any(
        'dossiers.update',
        'wms.execute',
        'warehouse.execute',
        'workflow.picking.execute',
        'dossiers.validate.exit',
        'dossiers.validate.removal',
      ),
      updatePaymentMethod: any(
        'finance.invoices.manage',
        'dossiers.validate.finance',
        'workflow.finance.validate',
      ),
      blockFile: any('dossiers.validate.dex', 'workflow.dex.validate'),
      unblockFile: any('dossiers.validate.dex', 'workflow.dex.validate'),
      updateCustoms: 'customs.manage',
      extendSommier: 'customs.sommiers.manage',
      updateExitCustomsDecl: 'customs.manage',
      gateOutExitMovement: any('gate.execute', 'workflow.gate_out.execute', 'wms.execute'),
      listAudit: any('dossiers.read', 'admin.audit.read'),
    },
  },
  WmsAiController: {
    write: any('wms.execute', 'dossiers.update'),
  },
  CargoController: { read: 'dossiers.read' },
  OperationsController: {
    read: any('dossiers.read', 'depotage.read', 'stuffing.read', 'warehouse.read', 'gate.read'),
    write: 'dossiers.update',
    handlers: {
      create: any('dossiers.create', 'workflow.dossier_create.execute'),
      removeOperation: any('dossiers.validate.dex', 'workflow.dex.validate', 'dossiers.delete'),
      close: any('dossiers.archive', 'workflow.close.execute'),
      submit: any('workflow.prealert.execute', 'dossiers.create', 'dossiers.update'),
      validate: 'dossiers.validate.entry',
      reject: 'dossiers.validate.entry',
      authorizeEntry: 'dossiers.validate.entry',
      emailEntryPass: 'dossiers.validate.entry',
      reserveCapacity: any('workflow.capacity.execute', 'dossiers.update'),
      validateDocuments: any(
        'workflow.doc_check.execute',
        'workflow.doc_check.validate',
        'dossiers.update',
      ),
      advance: any(
        'workflow.ops.execute',
        'workflow.picking.execute',
        'workflow.stock_check.execute',
        'workflow.stock_check.validate',
        'workflow.doc_check.execute',
        'workflow.doc_check.validate',
        'workflow.delivery_note.execute',
        'workflow.exit_order.execute',
        'depotage.execute',
        'stuffing.execute',
        'wms.execute',
        'warehouse.execute',
        'yard.execute',
        'gate.execute',
        'dossiers.update',
      ),
      gateIn: any('gate.execute', 'workflow.gate_in.execute'),
      updateGatePass: any('gate.execute', 'workflow.gate_in.execute'),
      inspectUnit: any(
        'gate.execute',
        'warehouse.execute',
        'yard.execute',
        'depotage.execute',
        'stuffing.execute',
        'workflow.doc_check.execute',
        'workflow.stock_check.execute',
        'dossiers.update',
      ),
      requestSlotChange: any('yard.execute', 'yard.containers.manage', 'dossiers.update'),
      decideSlotChange: any('dossiers.validate.dex', 'workflow.dex.validate', 'site.plan.manage'),
      validateDex: any('dossiers.validate.dex', 'workflow.dex.validate'),
      rewind: any('dossiers.validate.dex', 'workflow.dex.validate'),
    },
  },
  ReportsController: {
    read: any('reporting.read', 'reporting.export'),
    write: 'reporting.export',
    handlers: {
      chat: 'reporting.ai',
      listConversations: 'reporting.ai',
      getConversation: 'reporting.ai',
      listSchedules: 'reporting.schedule',
      createSchedule: 'reporting.schedule',
      updateSchedule: 'reporting.schedule',
      deleteSchedule: 'reporting.schedule',
      runSchedule: 'reporting.schedule',
    },
  },
  TruckLoadsController: {
    read: any('gate.read', 'gate.execute', 'tms.read', 'dossiers.read', 'depotage.read'),
    write: any('gate.execute', 'depotage.execute', 'workflow.ops.execute', 'dossiers.update'),
  },
  TransshipmentController: {
    read: any('gate.read', 'gate.execute', 'dossiers.read', 'depotage.read'),
    write: any('gate.execute', 'depotage.execute', 'workflow.ops.execute', 'dossiers.update'),
  },
  OpsQueryController: {
    read: 'dossiers.read',
    handlers: {
      getDashboard: 'dashboard.read',
      getExecutionQueue: any(
        'dossiers.read',
        'workflow.ops.execute',
        'gate.read',
        'warehouse.read',
        'yard.read',
      ),
      listPickupWaiting: any('tms.read', 'gate.read', 'dossiers.read'),
    },
  },
  YmsController: {
    read: 'yard.read',
    write: 'yard.execute',
    handlers: {
      getDashboard: any('dashboard.read', 'yard.read'),
      getParkStats: any('yard.containers.read', 'yard.read', 'dashboard.read'),
      getClientOverview: any('clients.read', 'yard.containers.read', 'yard.read'),
      listContainers: any('yard.containers.read', 'yard.read', 'clients.read'),
      getContainer: any('yard.containers.read', 'yard.read'),
      listMovements: any('yard.containers.read', 'yard.read'),
      getYardMap: any('site.plan.read', 'yard.read', 'gate.read'),
      getPositions: any('site.plan.read', 'yard.read'),
      updateGateInDate: any('gate.execute', 'workflow.gate_in.execute'),
      updateGateOutDate: any('gate.execute', 'workflow.gate_out.execute'),
      gateIn: any('gate.execute', 'workflow.gate_in.execute'),
      gateInFromPreGate: any('gate.execute', 'workflow.gate_in.execute'),
      gateInBulkFromPreGate: any('gate.execute', 'workflow.gate_in.execute'),
      gateOut: any('gate.execute', 'workflow.gate_out.execute'),
      confirmPosition: any('yard.execute', 'yard.containers.manage'),
      endDevanning: any('yard.execute', 'depotage.execute'),
      reposition: any('yard.execute', 'yard.containers.manage'),
    },
  },
  YmsReferentielsController: {
    read: 'referentiels.read',
    write: any('referentiels.manage', 'site.yard_config.manage'),
  },
  ReferentielsController: {
    read: 'referentiels.read',
    write: 'referentiels.manage',
    handlers: {
      listTariffs: 'finance.tariffs.read',
      createTariff: 'finance.tariffs.manage',
      updateTariff: 'finance.tariffs.manage',
      removeTariff: 'finance.tariffs.manage',
      upsertYard: any('referentiels.manage', 'site.yard_config.manage'),
      patchYardStackingRules: any('referentiels.manage', 'site.yard_config.manage'),
      deleteYard: any('referentiels.manage', 'site.yard_config.manage'),
    },
  },
  DosConfigController: {
    read: 'admin.settings.read',
    write: 'admin.settings.manage',
    handlers: {
      listBlockedClients: any('admin.settings.read', 'dossiers.read', 'clients.commercial.read'),
      isClientBlocked: any('dossiers.read', 'admin.settings.read'),
      blockClient: any('admin.settings.manage', 'dossiers.validate.dex'),
      unblockClient: any('admin.settings.manage', 'dossiers.validate.dex'),
      getStayEngine: any('admin.settings.read', 'finance.read'),
    },
  },
  InvoicesController: {
    read: any('finance.invoices.read', 'finance.read', 'finance.payments.read'),
    write: 'finance.invoices.manage',
    handlers: {
      validateDex: any('dossiers.validate.dex', 'workflow.dex.validate'),
      rejectDex: any('dossiers.validate.dex', 'workflow.dex.validate'),
    },
  },
  InvoicesListController: {
    read: any('finance.invoices.read', 'finance.read', 'finance.payments.read'),
  },
  PaymentsController: { write: 'finance.payments.manage' },
  ChargesPreviewController: {
    read: any('dossiers.create', 'finance.induced.read', 'finance.read', 'dossiers.commercial.read'),
    write: any('dossiers.create', 'finance.induced.read', 'finance.read', 'dossiers.commercial.read'),
  },
  InducedServicesController: {
    read: any('finance.induced.read', 'finance.read', 'dossiers.commercial.read'),
    write: any('finance.induced.manage', 'finance.manage'),
  },
  TmsController: {
    read: any('tms.read', 'tms.manage', 'tms.fleet.manage', 'tms.shuttle.manage', 'tms.pod.execute'),
    write: 'tms.manage',
    handlers: {
      createVehicle: any('tms.manage', 'tms.fleet.manage'),
      updateVehicle: any('tms.manage', 'tms.fleet.manage'),
      createDriver: any('tms.manage', 'tms.fleet.manage'),
      updateDriver: any('tms.manage', 'tms.fleet.manage'),
      createPortWindow: any('tms.manage', 'tms.shuttle.manage'),
      updatePortWindow: any('tms.manage', 'tms.shuttle.manage'),
      createTrip: any('tms.manage', 'tms.pod.execute'),
      updateTrip: any('tms.manage', 'tms.pod.execute'),
    },
  },
  NotificationsController: {
    read: any('notifications.read', 'notifications.manage'),
    write: 'notifications.manage',
    handlers: {
      send: any('notifications.send', 'notifications.manage'),
    },
  },
  AlertsController: {
    read: 'authenticated',
    write: 'authenticated',
    handlers: {
      scanSommier: 'admin.settings.manage',
      scanPositioning: 'admin.settings.manage',
      scanStayFranchise: 'admin.settings.manage',
    },
  },
};

export function resolveEndpointPermission(
  className: string,
  handlerName: string,
  method: string,
): string[] | null {
  const spec = ENDPOINT_ACCESS[className];
  if (!spec) return null;

  const handler = spec.handlers?.[handlerName];
  if (handler === 'authenticated') return ['authenticated'];
  if (handler) return Array.isArray(handler) ? handler : [handler];

  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  const code = write ? spec.write : spec.read;
  if (!code) return null;
  if (code === 'authenticated') return ['authenticated'];
  return Array.isArray(code) ? code : [code];
}
