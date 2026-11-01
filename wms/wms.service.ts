import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { PaymentsService } from '../payments/payments.service';
import { YmsService } from '../yms/yms.service';
import { InducedServicesService } from '../induced-services/induced-services.service';
import {
  ShipmentFileStatus,
  ShipmentLineStatus,
  ExitMovementStatus,
  ContainerType,
  OperationLineRole,
  OperationType,
  PaymentMethod,
  UserRole,
  YardContainerStatus,
} from '@prisma/client';
import { UpdateCargoContainerDto } from './dto/update-cargo-container.dto';
import { sizeForType } from '../common/container-iso';
import {
  CreateShipmentFileDto,
  InlineGateInLineDto,
} from './dto/create-shipment-file.dto';
import { AddCargoDto } from './dto/add-cargo.dto';
import { CreateShipmentLineDto } from './dto/create-shipment-line.dto';
import { CreateExitMovementDto } from './dto/create-exit-movement.dto';
import { OPERATION_TYPE_CFG } from '../operations/operation-types';
import { UpdateShipmentFileDto } from './dto/update-shipment-file.dto';
import { UpdateShipmentLineDto } from './dto/update-shipment-line.dto';
import { CustomsUpdateDto } from './dto/customs-update.dto';
import { ReceiveShipmentDto } from './dto/receive-shipment.dto';
import { PutawayConfirmDto } from './dto/putaway-confirm.dto';
import { ConfirmExitMovementDto } from './dto/confirm-exit-movement.dto';
import { BlockFileDto } from './dto/block-file.dto';
import { AzureDocumentStorageService } from './azure-document-storage.service';

const FILE_SELECT = {
  id: true,
  tenantId: true,
  clientId: true,
  voyageCode: true,
  clientRef: true,
  invoiceNumber: true,
  transportDocNumber: true,
  shipmentTypeCode: true,
  storageRegimeCode: true,
  customsDeclNumber: true,
  customsDeclDate: true,
  sommierExpiryDate: true,
  sommierOriginalDate: true,
  sommierExtendedAt: true,
  sommierExtensionsUsed: true,
  eta: true,
  entryDate: true,
  status: true,
  notes: true,
  driverName: true,
  driverPhone: true,
  truckPlate: true,
  targetLocation: true,
  putawayNote: true,
  putawayConfirmedAt: true,
  putawayConfirmedBy: true,
  blockedReason: true,
  blockedById: true,
  blockedAt: true,
  createdAt: true,
  updatedAt: true,
  defaultYardId: true,
  vatApplicable: true,
  paymentId: true,
  payment: {
    select: {
      id: true,
      termType: true,
      method: true,
      status: true,
      dueDate: true,
      validatedAt: true,
      validatedById: true,
      notes: true,
    },
  },
  shipmentType: { select: { label: true, icon: true } },
  storageRegime: {
    select: {
      label: true,
      labelShort: true,
      color: true,
      bg: true,
      sommierDays: true,
      sommierExtensionDays: true,
      sommierMaxExtensions: true,
    },
  },
  defaultYard: { select: { id: true, code: true, name: true, type: true } },
  client: {
    select: {
      id: true,
      name: true,
      slug: true,
      zoneAllocations: {
        select: {
          id: true,
          zoneId: true,
          quotaM2: true,
          isExclusive: true,
          notes: true,
          zone: {
            select: {
              id: true,
              code: true,
              label: true,
              surfaceM2: true,
              yard: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  },
  lines: {
    select: {
      id: true,
      status: true,
      packageCount: true,
      quantity: true,
      quantityOut: true,
      countedQuantity: true,
      countedAt: true,
      packageRef: true,
      packageTypeCode: true,
      description: true,
      packageType: { select: { label: true } },
      weightKg: true,
      volumeM3: true,
      surfaceM2: true,
      yardId: true,
      zoneId: true,
      receiptId: true,
      yard: { select: { id: true, code: true, name: true } },
      zone: { select: { id: true, code: true, label: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { lines: true, exitMovements: true } },
  // Version allégée (sans les sub-selects complets de FILE_DETAIL_SELECT) —
  // juste assez pour que dossiers-list.jsx calcule (a) un avancement réel par
  // dossier (toutes opérations confondues, pas seulement operations[0]), et
  // (b) un comptage réel de conteneurs/colis EN STOCK à travers tous les
  // dossiers (yardContainer.status/shipmentLine.status), sans charger le
  // détail complet de chaque ligne (slot, seal*, quality*, doc*, report*...).
  operations: {
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      // bonNumber/gatePasses/slot : signaux réels des étapes 3-5 du tronc
      // commun (capacité, Bon à Entrer, Gate In) dérivés par adaptFile()
      // côté front. Sans eux, un dossier jamais ouvert en détail restait
      // « sans Bon à Entrer » et n'apparaissait pas dans la file Gate In
      // (il fallait d'abord ouvrir le dossier pour déclencher refreshFile()).
      bonNumber: true,
      bonIssuedAt: true,
      gatePasses: {
        select: {
          id: true,
          transportMode: true,
          truckPlate: true,
          carrier: true,
          driverName: true,
          arrivedOperationLineIds: true,
          gateInDate: true,
          createdAt: true,
        },
        orderBy: { gateInDate: 'asc' as const },
      },
      lines: {
        select: {
          id: true,
          role: true,
          stepIdx: true,
          done: true,
          slot: true,
          cargoNature: true,
          quantity: true,
          expectedQuantity: true,
          yardContainerId: true,
          // N°/taille/poids : affichés dans la file Gate In et utilisés pour
          // l'EVP/poids de la colonne Cargaison de la liste (avant, seul le
          // statut était chargé : tout conteneur comptait 1 EVP, poids 0).
          yardContainer: {
            select: {
              id: true,
              status: true,
              containerNumber: true,
              isoTypeCode: true,
              sizeFt: true,
              grossWeightKg: true,
              sealNumber: true,
              containerType: true,
              isDangerousGoods: true,
              yardId: true,
            },
          },
          shipmentLineId: true,
          shipmentLine: { select: { status: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  exitMovements: {
    select: {
      id: true,
      status: true,
      exitVoyageCode: true,
      exitCustomsDecl: true,
      exitTransportDoc: true,
      exitShipmentTypeCode: true,
      exitShipmentType: { select: { label: true, icon: true } },
      exitDate: true,
      deliveryOrderRef: true,
      truckPlate: true,
      driverName: true,
      driverPhone: true,
      gateOutAt: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      exitLines: {
        select: {
          id: true,
          quantityOut: true,
          note: true,
          shipmentLine: {
            select: {
              id: true,
              packageRef: true,
              packageTypeCode: true,
              packageType: { select: { label: true } },
              quantity: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

// Création d'un dossier / ajout de cargaison avec de gros lots (50+
// conteneurs) : le délai par défaut de 5 s d'une transaction interactive
// Prisma était dépassé sur Neon → « Internal server error » à la soumission.
const BULK_TX_OPTIONS = { maxWait: 20_000, timeout: 120_000 };

// Sélecteur étendu pour la vue détail — inclut receipts
const FILE_DETAIL_SELECT = {
  ...FILE_SELECT,
  yardContainerId: true,
  yardContainer: {
    select: {
      id: true,
      containerNumber: true,
      status: true,
      isoTypeCode: true,
    },
  },
  operations: {
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      closedAt: true,
      submittedAt: true,
      submittedById: true,
      decidedAt: true,
      decidedById: true,
      decisionComment: true,
      storageBillingStartedAt: true,
      storageFreetimeDays: true,
      storageBillingEndedAt: true,
      storageBillableDays: true,
      bonNumber: true,
      bonIssuedAt: true,
      bonIssuedById: true,
      bonCheckContract: true,
      bonCheckAccount: true,
      bonCheckQuote: true,
      lines: {
        select: {
          id: true,
          role: true,
          quantity: true,
          expectedQuantity: true,
          cargoNature: true,
          // Avancement RÉEL par unité dans le pipeline OPERATION_TYPE_CFG[type].steps
          // (voir OperationLine.stepIdx/done, schema.prisma) — lu par
          // dos.unitOp() côté frontend (dos-store.js) pour dériver l'étape
          // courante de CHAQUE unité indépendamment des autres.
          stepIdx: true,
          done: true,
          sealRead: true,
          sealState: true,
          sealWitness: true,
          sealCheckedAt: true,
          qualityResult: true,
          qualityNc: true,
          qualityCheckedAt: true,
          docNumber: true,
          docSentTo: true,
          docIssuedAt: true,
          reportNumber: true,
          reportReceived: true,
          reportSignDmt: true,
          reportSignThird: true,
          reportIssuedAt: true,
          gateOutDriver: true,
          gateOutDestination: true,
          gateOutAt: true,
          shipmentLineId: true,
          shipmentLine: {
            select: {
              id: true,
              packageRef: true,
              packageTypeCode: true,
              quantity: true,
              weightKg: true,
              volumeM3: true,
              description: true,
              status: true,
            },
          },
          yardContainerId: true,
          yardContainer: {
            select: {
              id: true,
              containerNumber: true,
              isoTypeCode: true,
              sizeFt: true,
              sealNumber: true,
              grossWeightKg: true,
              status: true,
              containerType: true,
              isDangerousGoods: true,
              yardId: true,
              truckPlate: true,
              driverName: true,
              notes: true,
            },
          },
          slot: true,
          truckPlate: true,
          truckCarrier: true,
          truckAssignedAt: true,
          pickupTruckPlate: true,
          pickupTruckCarrier: true,
          pickupDriverName: true,
          pickupDriverCin: true,
          pickupPermitNo: true,
          pickupLoadedAt: true,
          equipmentName: true,
          handlingCrewType: true,
          handlingCrewCount: true,
          groundedAt: true,
          // Chargements camion partiels (transbordement) de cette unité.
          truckLoadLines: {
            where: { truckLoad: { status: { not: 'CANCELLED' as const } } },
            select: {
              id: true,
              quantity: true,
              truckLoad: {
                select: {
                  id: true,
                  plate: true,
                  carrier: true,
                  driverName: true,
                  status: true,
                  loadedAt: true,
                  gateOutAt: true,
                },
              },
            },
          },
          // Historique par étape (moyens mobilisés, retours arrière + motif).
          stepLogs: {
            select: {
              id: true,
              stepIdx: true,
              stepLabel: true,
              kind: true,
              byId: true,
              equipmentName: true,
              handlingCrewType: true,
              handlingCrewCount: true,
              reason: true,
              performedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
      entryPassEmails: {
        select: { id: true, to: true, cc: true, message: true, sentAt: true },
        orderBy: { sentAt: 'asc' as const },
      },
      gatePasses: {
        select: {
          id: true,
          transportMode: true,
          vehicleId: true,
          driverId: true,
          truckPlate: true,
          carrier: true,
          driverName: true,
          driverCin: true,
          permitNo: true,
          arrivedOperationLineIds: true,
          gateInDate: true,
          createdAt: true,
        },
        orderBy: { gateInDate: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  receipts: {
    select: {
      id: true,
      entryDate: true,
      transportDocNumber: true,
      driverName: true,
      driverPhone: true,
      truckPlate: true,
      targetLocation: true,
      notes: true,
      comments: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          packageRef: true,
          packageTypeCode: true,
          packageCount: true,
          quantity: true,
          description: true,
          weightKg: true,
          volumeM3: true,
          surfaceM2: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  documents: {
    select: {
      id: true,
      name: true,
      attached: true,
      attachedAt: true,
      attachedById: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  auditLogs: {
    select: {
      id: true,
      action: true,
      label: true,
      path: true,
      field: true,
      from: true,
      to: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 300,
  },
} as const;

@Injectable()
export class WmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService,
    private readonly paymentsService: PaymentsService,
    private readonly ymsService: YmsService,
    private readonly documentStorage: AzureDocumentStorageService,
    private readonly inducedServices: InducedServicesService,
  ) {}

  // Charges du dossier recalculées depuis la grille tarifaire (tarifs
  // « Obligatoire » des opérations du dossier) — côté serveur, pour ne plus
  // dépendre d'un appel du frontend soumis aux droits finance. Best-effort :
  // n'empêche jamais l'action principale (création, ajout de cargaison…).
  private async syncCharges(fileId: string, tenantId: string) {
    const client = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { client: { select: { defaultFreetimeDays: true } } },
    });
    await this.inducedServices
      .resolve(fileId, tenantId, {
        freetime: client?.client?.defaultFreetimeDays ?? undefined,
      })
      .catch(() => undefined);
  }

  // ── ShipmentFiles ────────────────────────────────────────────────────────

  async listFiles(
    tenantId: string,
    params: {
      status?: ShipmentFileStatus;
      search?: string;
      clientId?: string;
      // Filtre période : bornes en jours inclusifs (YYYY-MM-DD) sur le champ
      // date choisi (liste blanche — jamais un nom de colonne libre).
      dateField?: string;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { status, search, clientId, from, to, skip = 0, take = 50 } = params;
    const dateField = ['createdAt', 'eta', 'entryDate'].includes(
      params.dateField ?? '',
    )
      ? (params.dateField as 'createdAt' | 'eta' | 'entryDate')
      : 'createdAt';
    const dateRange: { gte?: Date; lt?: Date } = {};
    if (from) dateRange.gte = new Date(`${from}T00:00:00`);
    if (to) {
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      dateRange.lt = end;
    }
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
      ...(from || to ? { [dateField]: dateRange } : {}),
      ...(search
        ? {
            OR: [
              {
                client: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
              {
                voyageCode: { contains: search, mode: 'insensitive' as const },
              },
              { clientRef: { contains: search, mode: 'insensitive' as const } },
              {
                invoiceNumber: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                customsDeclNumber: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.shipmentFile.count({ where }),
      this.prisma.shipmentFile.findMany({
        where,
        select: FILE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        // Plafond par page : le front charge la liste complète page par page
        // (loadDossiers), jamais en une requête illimitée.
        take: Math.min(Math.max(take, 1), 200),
      }),
    ]);

    return { total, items };
  }

  // ── Dashboard stats ──────────────────────────────────────────────────────────

  async getDashboardStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const [
      totalFiles,
      inStock,
      partialOut,
      blocked,
      pendingPutaway,
      customsPending,
      linesInStock,
      exitedToday,
      pendingGateOut,
      somExpired,
      somIn30,
      clientCount,
      byRegime,
      byShipmentType,
      linesWithSurface,
      filesByClient,
    ] = await this.prisma.$transaction([
      this.prisma.shipmentFile.count({ where: { tenantId } }),
      this.prisma.shipmentFile.count({
        where: { tenantId, status: 'IN_STOCK' },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, status: 'PARTIAL_OUT' },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, status: 'BLOCKED' },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, status: 'PENDING_PUTAWAY' },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, status: 'CUSTOMS_PENDING' },
      }),
      this.prisma.shipmentLine.count({
        where: { shipmentFile: { tenantId }, status: 'IN_STOCK' },
      }),
      this.prisma.shipmentLine.count({
        where: {
          shipmentFile: { tenantId },
          status: 'OUT',
          exitLines: {
            some: { exitMovement: { exitDate: { gte: today, lt: tomorrow } } },
          },
        },
      }),
      this.prisma.exitMovement.count({
        where: {
          shipmentFile: { tenantId },
          status: 'CONFIRMED',
          gateOutAt: null,
        },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, sommierExpiryDate: { lt: today } },
      }),
      this.prisma.shipmentFile.count({
        where: { tenantId, sommierExpiryDate: { gte: today, lte: in30 } },
      }),
      // Nombre de clients actifs liés à ce tenant opérateur
      this.prisma.tenant.count({
        where: {
          type: 'CLIENT',
          isActive: true,
          clientDossiers: { some: { tenantId } },
        },
      }),
      // Répartition par régime (dossiers actifs)
      this.prisma.shipmentFile.groupBy({
        by: ['storageRegimeCode'],
        where: { tenantId, status: { in: ['IN_STOCK', 'PARTIAL_OUT'] } },
        _count: true,
        orderBy: { storageRegimeCode: 'asc' },
      }),
      // Répartition par type d'expédition (dossiers actifs)
      this.prisma.shipmentFile.groupBy({
        by: ['shipmentTypeCode'],
        where: { tenantId, status: { in: ['IN_STOCK', 'PARTIAL_OUT'] } },
        _count: true,
        orderBy: { shipmentTypeCode: 'asc' },
      }),
      // Surface m² par yard — lignes en stock
      this.prisma.shipmentLine.findMany({
        where: {
          shipmentFile: { tenantId },
          status: 'IN_STOCK',
          yardId: { not: null },
        },
        select: {
          yardId: true,
          surfaceM2: true,
          yard: { select: { id: true, code: true, name: true } },
        },
      }),
      // Dossiers par client (actifs)
      this.prisma.shipmentFile.findMany({
        where: {
          tenantId,
          status: { in: ['IN_STOCK', 'PARTIAL_OUT'] },
          clientId: { not: null },
        },
        select: {
          clientId: true,
          client: { select: { name: true, brandColor: true } },
        },
      }),
    ]);

    // Agréger surface par yard côté JS (groupBy avec _sum non supporté sur Float nullable dans toutes versions)
    const surfaceByYardMap = new Map<
      string,
      { yardId: string; code: string; name: string; surfaceM2: number }
    >();
    for (const l of linesWithSurface) {
      if (!l.yardId || !l.yard) continue;
      const prev = surfaceByYardMap.get(l.yardId);
      if (prev) {
        prev.surfaceM2 += l.surfaceM2 ?? 0;
      } else {
        surfaceByYardMap.set(l.yardId, {
          yardId: l.yardId,
          code: l.yard.code,
          name: l.yard.name,
          surfaceM2: l.surfaceM2 ?? 0,
        });
      }
    }
    const surfaceByYard = Array.from(surfaceByYardMap.values()).sort(
      (a, b) => b.surfaceM2 - a.surfaceM2,
    );

    // Agréger dossiers par client
    const filesByClientMap = new Map<
      string,
      { clientId: string; name: string; color: string; count: number }
    >();
    for (const f of filesByClient) {
      if (!f.clientId || !f.client) continue;
      const prev = filesByClientMap.get(f.clientId);
      if (prev) {
        prev.count++;
      } else {
        filesByClientMap.set(f.clientId, {
          clientId: f.clientId,
          name: f.client.name,
          color: f.client.brandColor ?? '#0050A0',
          count: 1,
        });
      }
    }
    const filesByClientArr = Array.from(filesByClientMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return {
      files: {
        total: totalFiles,
        inStock,
        partialOut,
        blocked,
        pendingPutaway,
        customsPending,
        activeStock: inStock + partialOut,
      },
      lines: { inStock: linesInStock, exitedToday },
      exits: { pendingGateOut },
      sommiers: { expired: somExpired, soon: somIn30 },
      clients: { count: clientCount },
      breakdown: {
        byRegime,
        byShipmentType,
        surfaceByYard,
        filesByClient: filesByClientArr,
      },
    };
  }

  // ── Clients (tenants type=CLIENT visibles par l'opérateur) ──────────────────

  async listClients(operatorTenantId: string) {
    // Retourne tous les tenants CLIENT + leurs stats dossiers pour cet opérateur
    const clients = await this.prisma.tenant.findMany({
      where: { type: 'CLIENT', isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        site: true,
        brandColor: true,
        brandInitials: true,
        createdAt: true,
        address: true,
        contact: true,
        ninea: true,
        rccm: true,
        contractRef: true,
        contractOk: true,
        balance: true,
        defaultPaymentTerms: true,
        defaultPaymentMode: true,
        defaultFreetimeDays: true,
        emptyFreetimeDays: true,
        containerPrefixes: true,
        currency: true,
        paymentDelayDays: true,
        contractEndsAt: true,
        localAgent: true,
        tariffGridLabel: true,
        contacts: true,
        users: {
          select: { id: true, email: true, role: true, isActive: true },
          take: 5,
        },
        clientDossiers: {
          where: { tenantId: operatorTenantId },
          select: { id: true, status: true, voyageCode: true },
        },
        zoneAllocations: {
          select: {
            id: true,
            zoneId: true,
            quotaM2: true,
            isExclusive: true,
            notes: true,
            zone: {
              select: {
                id: true,
                code: true,
                label: true,
                surfaceM2: true,
                yard: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return clients;
  }

  async getClient(clientId: string) {
    const client = await this.prisma.tenant.findFirst({
      where: { id: clientId, type: 'CLIENT' },
      select: {
        id: true,
        name: true,
        slug: true,
        site: true,
        brandColor: true,
        brandInitials: true,
        brandTagline: true,
        plan: true,
        isActive: true,
        createdAt: true,
        address: true,
        contact: true,
        ninea: true,
        rccm: true,
        contractRef: true,
        contractOk: true,
        balance: true,
        defaultPaymentTerms: true,
        defaultPaymentMode: true,
        defaultFreetimeDays: true,
        emptyFreetimeDays: true,
        containerPrefixes: true,
        currency: true,
        paymentDelayDays: true,
        contractEndsAt: true,
        localAgent: true,
        tariffGridLabel: true,
        contacts: true,
        users: {
          select: { id: true, email: true, role: true, isActive: true },
        },
        zoneAllocations: {
          select: {
            id: true,
            zoneId: true,
            quotaM2: true,
            isExclusive: true,
            notes: true,
            zone: {
              select: {
                id: true,
                code: true,
                label: true,
                surfaceM2: true,
                yard: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    return client;
  }

  async createClient(dto: {
    name: string;
    site?: string;
    brandTagline?: string;
  }) {
    const slug =
      dto.name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 48) +
      '-' +
      Math.random().toString(36).slice(2, 6);
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug,
        type: 'CLIENT',
        site: dto.site,
        brandTagline: dto.brandTagline,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        site: true,
        brandColor: true,
        brandInitials: true,
        brandTagline: true,
        isActive: true,
      },
    });
  }

  async updateClient(
    clientId: string,
    dto: {
      name?: string;
      site?: string;
      brandColor?: string;
      brandInitials?: string;
      brandTagline?: string;
    },
  ) {
    return this.prisma.tenant.update({
      where: { id: clientId },
      data: dto,
      select: {
        id: true,
        name: true,
        slug: true,
        site: true,
        brandColor: true,
        brandInitials: true,
        brandTagline: true,
        isActive: true,
      },
    });
  }

  async softDeleteClient(clientId: string) {
    const client = await this.prisma.tenant.findFirst({
      where: { id: clientId, type: 'CLIENT' },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    return this.prisma.tenant.update({
      where: { id: clientId },
      data: { isActive: false },
      select: { id: true, isActive: true },
    });
  }

  // ── Allocations zones clients ─────────────────────────────────────────────

  private readonly ALLOC_SELECT = {
    id: true,
    clientId: true,
    zoneId: true,
    quotaM2: true,
    isExclusive: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    zone: {
      select: {
        id: true,
        code: true,
        label: true,
        surfaceM2: true,
        yard: { select: { id: true, code: true, name: true } },
      },
    },
    client: { select: { id: true, name: true, slug: true, brandColor: true } },
  } as const;

  async listAllocations(
    tenantId: string,
    filters: { clientId?: string; zoneId?: string } = {},
  ) {
    return this.prisma.clientZoneAllocation.findMany({
      where: {
        tenantId,
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
      },
      select: this.ALLOC_SELECT,
      orderBy: [{ client: { name: 'asc' } }, { zone: { label: 'asc' } }],
    });
  }

  // Valide que quotaM2 ne dépasse pas la surface restante de la zone, en excluant l'allocation `excludeId`
  private async validateQuotaAgainstZone(
    zoneId: string,
    quotaM2: number | undefined | null,
    excludeId?: string,
  ) {
    if (!quotaM2) return; // pas de quota défini → pas de contrainte

    const [zone, otherAllocs, occupiedLines] = await Promise.all([
      this.prisma.storageZone.findUnique({
        where: { id: zoneId },
        select: { surfaceM2: true, label: true },
      }),
      // Quotas alloués à d'autres clients sur la même zone
      this.prisma.clientZoneAllocation.findMany({
        where: { zoneId, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { quotaM2: true },
      }),
      // Colis physiquement stockés dans la zone (IN_STOCK ou PENDING_PUTAWAY)
      this.prisma.shipmentLine.findMany({
        where: { zoneId, status: { in: ['IN_STOCK', 'RESERVED'] } },
        select: { surfaceM2: true },
      }),
    ]);

    if (!zone?.surfaceM2) return; // zone sans surface définie → pas de contrainte

    const quotasAlloues = otherAllocs.reduce(
      (sum, a) => sum + (a.quotaM2 ?? 0),
      0,
    );
    const surfaceOccupee = occupiedLines.reduce(
      (sum, l) => sum + (l.surfaceM2 ?? 0),
      0,
    );
    const dejaUtilise = Math.max(quotasAlloues, surfaceOccupee); // on prend le plus contraignant
    const remaining = zone.surfaceM2 - dejaUtilise;

    if (quotaM2 > remaining) {
      throw new BadRequestException(
        `Quota demandé (${quotaM2} m²) dépasse la surface disponible de la zone "${zone.label}". ` +
          `Surface totale : ${zone.surfaceM2} m² — ` +
          `occupée par des colis : ${surfaceOccupee.toFixed(1)} m² — ` +
          `allouée à d'autres clients : ${quotasAlloues.toFixed(1)} m² — ` +
          `disponible : ${remaining.toFixed(1)} m².`,
      );
    }
  }

  async createAllocation(
    tenantId: string,
    dto: {
      clientId: string;
      zoneId: string;
      quotaM2?: number;
      isExclusive?: boolean;
      notes?: string;
    },
  ) {
    const existing = await this.prisma.clientZoneAllocation.findUnique({
      where: {
        clientId_zoneId: { clientId: dto.clientId, zoneId: dto.zoneId },
      },
    });
    if (existing)
      throw new BadRequestException(
        'Une allocation existe déjà pour ce client et cette zone.',
      );

    // Si zone exclusive → aucune autre allocation ne doit exister sur cette zone
    if (dto.isExclusive) {
      const others = await this.prisma.clientZoneAllocation.count({
        where: { zoneId: dto.zoneId },
      });
      if (others > 0)
        throw new BadRequestException(
          "Impossible de marquer la zone comme exclusive : d'autres clients y sont déjà alloués.",
        );
    } else {
      // Si la zone a déjà une allocation exclusive d'un autre client → refuser
      const exclusiveOther = await this.prisma.clientZoneAllocation.findFirst({
        where: { zoneId: dto.zoneId, isExclusive: true },
      });
      if (exclusiveOther)
        throw new BadRequestException(
          'Cette zone est marquée comme exclusive pour un autre client.',
        );
    }

    await this.validateQuotaAgainstZone(dto.zoneId, dto.quotaM2);

    return this.prisma.clientZoneAllocation.create({
      data: { tenantId, ...dto },
      select: this.ALLOC_SELECT,
    });
  }

  async updateAllocation(
    id: string,
    tenantId: string,
    dto: { quotaM2?: number | null; isExclusive?: boolean; notes?: string },
  ) {
    const alloc = await this.prisma.clientZoneAllocation.findFirst({
      where: { id, tenantId },
    });
    if (!alloc) throw new NotFoundException('Allocation introuvable.');

    // Revalider l'exclusivité si elle change
    if (dto.isExclusive === true && !alloc.isExclusive) {
      const others = await this.prisma.clientZoneAllocation.count({
        where: { zoneId: alloc.zoneId, id: { not: id } },
      });
      if (others > 0)
        throw new BadRequestException(
          "Impossible de marquer la zone comme exclusive : d'autres clients y sont déjà alloués.",
        );
    }

    const newQuota = dto.quotaM2 !== undefined ? dto.quotaM2 : alloc.quotaM2;
    await this.validateQuotaAgainstZone(alloc.zoneId, newQuota, id);

    return this.prisma.clientZoneAllocation.update({
      where: { id },
      data: dto,
      select: this.ALLOC_SELECT,
    });
  }

  async deleteAllocation(id: string, tenantId: string) {
    const alloc = await this.prisma.clientZoneAllocation.findFirst({
      where: { id, tenantId },
    });
    if (!alloc) throw new NotFoundException('Allocation introuvable.');
    await this.prisma.clientZoneAllocation.delete({ where: { id } });
    return { ok: true };
  }

  async getFile(id: string, tenantId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: FILE_DETAIL_SELECT,
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    const referenceIds = [
      ...file.lines.map((line) => line.id),
      ...file.operations.flatMap((operation) =>
        operation.lines
          .map((line) => line.yardContainerId)
          .filter((value): value is string => !!value),
      ),
    ];
    const inspections = referenceIds.length
      ? await this.prisma.eIR.findMany({
          where: { tenantId, referenceId: { in: referenceIds } },
          select: {
            id: true,
            reference: true,
            referenceId: true,
            type: true,
            checks: true,
            condition: true,
            description: true,
            photos: true,
            generatedById: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return { ...file, inspections };
  }

  // Vérification temps réel exposée via GET .../check-voyage-code
  // (StepClientOps, wizard de création côté frontend) — évite de dérouler
  // tout le wizard pour découvrir la collision à la toute fin. Réutilisée
  // ici comme garde-fou final avant insertion (aucune contrainte @@unique
  // en base sur ce champ : validation purement applicative).
  async checkVoyageCodeAvailable(tenantId: string, voyageCode: string) {
    const trimmed = voyageCode?.trim();
    if (!trimmed) return { available: true };
    const existing = await this.prisma.shipmentFile.findFirst({
      where: { tenantId, voyageCode: trimmed },
      select: { id: true },
    });
    return { available: !existing };
  }

  async createFile(
    tenantId: string,
    dto: CreateShipmentFileDto,
    operatorId?: string,
  ) {
    const { available } = await this.checkVoyageCodeAvailable(
      tenantId,
      dto.voyageCode,
    );
    if (!available)
      throw new BadRequestException(
        `Le code voyage "${dto.voyageCode}" est déjà utilisé par un autre dossier.`,
      );

    if (dto.clientId) {
      const blocked = await this.prisma.clientAccountingBlock.findUnique({
        where: { tenantId_clientId: { tenantId, clientId: dto.clientId } },
      });
      if (blocked)
        throw new BadRequestException(
          `Client bloqué par la comptabilité (${blocked.reason}) — aucun nouveau dossier ne peut être créé. Contactez le DEX pour régularisation.`,
        );
    }

    let sommierExpiryDate: Date | undefined;
    if (dto.storageRegimeCode && dto.customsDeclDate) {
      const regime = await this.prisma.storageRegimeRef.findFirst({
        where: { tenantId, code: dto.storageRegimeCode },
        select: { sommierDays: true },
      });
      if (regime?.sommierDays) {
        const base = new Date(dto.customsDeclDate);
        sommierExpiryDate = new Date(base);
        sommierExpiryDate.setDate(
          sommierExpiryDate.getDate() + regime.sommierDays,
        );
      }
    }

    const payment = dto.paymentTerm
      ? await this.paymentsService.createPayment(tenantId, dto.paymentTerm)
      : null;

    if (dto.yardContainerId) {
      const container = await this.prisma.yardContainer.findFirst({
        where: { id: dto.yardContainerId, tenantId },
        select: { id: true },
      });
      if (!container) throw new NotFoundException('Conteneur introuvable.');
    }

    // Compat ascendante : `operationType` (singulier) reste accepté seul ;
    // s'il est fourni en même temps que `operationTypes`, ce dernier prime
    // (le frontend ne devrait jamais envoyer les deux, mais on privilégie le
    // champ le plus expressif en cas de conflit).
    const operationTypes: OperationType[] =
      dto.operationTypes ?? (dto.operationType ? [dto.operationType] : []);

    // ICD_FULL/ICD_EMPTY/DEP_TRANS/DEP_STOCK ont désormais tous un vrai Gate
    // In SÉPARÉ dans le pipeline CORE_STEPS (voir
    // OperationsService.ENTRY_AUTH_TYPES) — un dossier dont TOUS les types
    // sont de ceux-là n'annonce que la cargaison à la création
    // (announceContainers, pas de position/gate-in réel) ; le Gate In réel
    // (avec camion/chauffeur) reste une étape séparée à exécuter après
    // validation N+1, avant que "Réception conteneur" (premier step métier
    // du dépotage) puisse démarrer. EMP_EXPORT reste exclu : son conteneur
    // vide est réservé/reçu comme étape de SON PROPRE pipeline, pas via un
    // Gate In générique du tronc commun.
    // Dossier « Stockage conteneurs vides » : ses conteneurs SONT vides, quel
    // que soit leur type ISO (un 40RF vide n'a pas besoin de prise reefer) —
    // ils étaient enregistrés « sec »/« reefer », donc facturés au tarif plein
    // et refusés par les blocs faute de bloc reefer.
    if (
      dto.containers?.length &&
      operationTypes.length > 0 &&
      operationTypes.every((t) => t === OperationType.ICD_EMPTY)
    )
      dto.containers = dto.containers.map((c) => ({
        ...c,
        containerType: ContainerType.EMPTY,
      }));

    const announceOnly =
      operationTypes.length > 0 &&
      operationTypes.every(
        (t) =>
          t === OperationType.ICD_FULL ||
          t === OperationType.ICD_EMPTY ||
          t === OperationType.DEP_TRANS ||
          t === OperationType.DEP_STOCK,
      );

    // Numéro de conteneur dupliqué DANS le même payload (avant même de taper
    // la base) — évite un rollback tardif de transaction pour une erreur de
    // saisie détectable immédiatement.
    if (dto.containers?.length) {
      const numbers = dto.containers.map((c) =>
        c.containerNumber.toUpperCase(),
      );
      const dup = numbers.find((n, i) => numbers.indexOf(n) !== i);
      if (dup)
        throw new BadRequestException(
          `Le conteneur ${dup} apparaît plusieurs fois dans la cargaison du dossier.`,
        );
      await this.ymsService.assertContainerNumbersFree(tenantId, numbers);
      if (announceOnly) {
        // Simple annonce (voir announceContainers()) : aucun gate-in réel,
        // donc aucun utilisateur authentifié requis à ce stade — mais un
        // yard cible reste nécessaire (YardContainer.yardId est obligatoire
        // même sans position assignée).
        if (!dto.defaultYardId)
          throw new BadRequestException(
            'defaultYardId requis pour annoncer des conteneurs à la création du dossier.',
          );
      } else {
        // YardMovement.operatorId est une FK obligatoire vers User — un
        // gate-in "inline" nécessite donc un utilisateur authentifié réel.
        if (!operatorId)
          throw new BadRequestException(
            "Utilisateur requis pour créer un conteneur (gate-in) à la création d'un dossier.",
          );
      }
    }

    return this.prisma
      .$transaction(async (tx) => {
        const file = await tx.shipmentFile.create({
          data: {
            tenantId,
            voyageCode: dto.voyageCode,
            shipmentTypeCode: dto.shipmentTypeCode,
            storageRegimeCode: dto.storageRegimeCode,
            clientId: dto.clientId,
            clientRef: dto.clientRef,
            invoiceNumber: dto.invoiceNumber,
            transportDocNumber: dto.transportDocNumber,
            customsDeclNumber: dto.customsDeclNumber,
            ...(dto.customsDeclDate
              ? { customsDeclDate: new Date(dto.customsDeclDate) }
              : {}),
            ...(sommierExpiryDate ? { sommierExpiryDate } : {}),
            ...(dto.eta ? { eta: new Date(dto.eta) } : {}),
            notes: dto.notes,
            ...(dto.defaultYardId ? { defaultYardId: dto.defaultYardId } : {}),
            ...(dto.vatApplicable !== undefined
              ? { vatApplicable: dto.vatApplicable }
              : {}),
            status: ShipmentFileStatus.DRAFT,
            ...(payment ? { paymentId: payment.id } : {}),
            ...(dto.yardContainerId
              ? { yardContainerId: dto.yardContainerId }
              : {}),
          },
          select: FILE_SELECT,
        });

        if (dto.documentNames?.length) {
          const uniqueNames = Array.from(new Set(dto.documentNames));
          await tx.shipmentFileDocument.createMany({
            data: uniqueNames.map((name) => ({
              shipmentFileId: file.id,
              tenantId,
              name,
            })),
          });
        }

        if (dto.serviceLines?.length) {
          await tx.shipmentFileServiceLine.createMany({
            data: dto.serviceLines.map((l) => ({
              shipmentFileId: file.id,
              tenantId,
              tariffId: l.tariffId,
              label: l.label,
              unit: l.unit,
              quantity: l.quantity,
              rate: Math.round(l.rate),
              mandatory: l.mandatory,
              ruleLabel: l.ruleLabel,
            })),
          });
        }

        // Dossier créé depuis un conteneur en yard → marque le conteneur en
        // dépotage (badge visible côté YMS, tant qu'aucun dossier lié n'est FULLY_OUT).
        if (dto.yardContainerId) {
          await tx.yardContainer.update({
            where: { id: dto.yardContainerId },
            data: { isBeingDevanned: true },
          });
        }

        // ── Cargaison "inline" : conteneurs (CT) ──────────────────────────────
        // Deux chemins selon le mélange de types sélectionnés :
        //   - Si TOUS les types sont ICD_FULL/ICD_EMPTY/DEP_TRANS/DEP_STOCK
        //     (ceux qui ont désormais un vrai Gate In SÉPARÉ dans le pipeline
        //     CORE_STEPS — voir OperationsService.ENTRY_AUTH_TYPES) : ANNONCE
        //     uniquement (YmsService.announceContainers()), aucune position
        //     allouée, statut GATE_IN_PROGRESS — le vrai positionnement
        //     (reserveCapacity) et le vrai Gate In restent des étapes
        //     séparées à exécuter après validation N+1. Pour DEP_TRANS/
        //     DEP_STOCK, "Réception conteneur" (premier step métier de leur
        //     pipeline) ne devient exécutable qu'après confirmation du Gate
        //     In (IN_YARD) — voir le rôle OUTPUT plus bas.
        //   - Sinon (EMP_EXPORT présent, seul ou mélangé aux autres types) :
        //     comportement historique conservé (gateInBatch(), IN_YARD
        //     immédiat) — un dossier mixte partage la même liste de
        //     conteneurs entre tous ses types (voir plus bas) donc la
        //     décision ne peut pas être prise par conteneur. `announceOnly`
        //     calculé plus haut, avant les validations de garde
        //     (defaultYardId/operatorId requis).
        const createdContainers: {
          line: InlineGateInLineDto;
          container: { id: string };
        }[] = [];
        if (dto.containers?.length) {
          if (announceOnly) {
            const announced = await this.ymsService.announceContainers(
              tenantId,
              dto.defaultYardId!,
              dto.containers.map((line) => ({
                containerNumber: line.containerNumber,
                isoTypeCode: line.isoTypeCode,
                sizeFt: line.sizeFt,
                containerType: line.containerType,
                grossWeightKg: line.grossWeightKg,
                shippingLine: line.shippingLine,
                voyageCode: dto.voyageCode,
                customsHold: line.customsHold,
                isDangerousGoods: line.isDangerousGoods,
                sealNumber: line.sealNumber,
                clientId: dto.clientId,
                notes: line.bl ? `BL: ${line.bl}` : undefined,
              })),
              tx,
            );
            createdContainers.push(
              ...announced.map((container, idx) => ({
                line: dto.containers![idx],
                container,
              })),
            );
          } else {
            if (!operatorId)
              throw new BadRequestException(
                "Utilisateur requis pour créer un conteneur (gate-in) à la création d'un dossier.",
              );
            const gateInResults = await this.ymsService.gateInBatch(
              tenantId,
              operatorId,
              dto.containers.map((line) => ({
                containerNumber: line.containerNumber,
                isoTypeCode: line.isoTypeCode,
                sizeFt: line.sizeFt,
                containerType: line.containerType,
                grossWeightKg: line.grossWeightKg,
                shippingLine: line.shippingLine,
                voyageCode: dto.voyageCode,
                customsHold: line.customsHold,
                isDangerousGoods: line.isDangerousGoods,
                sealNumber: line.sealNumber,
                clientId: dto.clientId,
                yardId: dto.defaultYardId,
                notes: line.bl ? `BL: ${line.bl}` : undefined,
              })),
              tx,
            );
            createdContainers.push(
              ...gateInResults.map((r, idx) => ({
                line: dto.containers![idx],
                container: r.container,
              })),
            );
          }
        }

        // ── Cargaison "inline" : lignes de marchandise (CV) ───────────────────
        // Réutilise le statut par défaut du modèle (PENDING) sauf pour ENT_IN
        // où la marchandise est directement mise en stock (IN_STOCK) — c'est
        // la sémantique OUTPUT du pipeline ENT_IN (voir OPERATION_TYPE_CFG /
        // table OPERATION_TYPES du claude.md : ENT_IN produit
        // ShipmentLine[IN_STOCK]).
        // Colis ENT_IN : créés PENDING (attendus). Ils passent IN_STOCK au
        // Gate In réel (OperationsService.gateIn()) — les créer IN_STOCK
        // d'emblée les affichait « En stock » avant toute arrivée et les
        // sortait de la file Gate In.
        const createdLines: { id: string }[] = [];
        for (const line of dto.lines ?? []) {
          const created = await tx.shipmentLine.create({
            data: {
              shipmentFileId: file.id,
              tenantId,
              packageRef: line.packageRef,
              packageTypeCode: line.packageTypeCode ?? 'OTHER',
              packageCount: line.packageCount,
              quantity: line.quantity ?? 1,
              weightKg: line.weightKg,
              volumeM3: line.volumeM3,
              surfaceM2: line.surfaceM2,
              description: line.description,
              ...(line.yardId ? { yardId: line.yardId } : {}),
              ...(line.zoneId ? { zoneId: line.zoneId } : {}),
            },
          });
          createdLines.push(created);
        }

        // ── Opérations initiales portées par ce dossier (voir claude.md,
        // OPÉRATIONS ET PIPELINE) — un dossier n'a de sens que s'il porte au
        // moins une opération. Toutes créées dans la même transaction que le
        // dossier et sa cargaison, avec attribution des OperationLine (rôle
        // INPUT/OUTPUT) selon le type — voir le commentaire par branche
        // ci-dessous pour la justification de chaque rôle.
        const operations: { id: string; type: OperationType }[] = [];
        for (const type of operationTypes) {
          const cfg = OPERATION_TYPE_CFG[type];
          const operation = await tx.operation.create({
            data: {
              shipmentFileId: file.id,
              tenantId,
              type,
              status: cfg.initialStatus,
            },
          });
          operations.push(operation);

          if (dto.yardContainerId) {
            // Dossier ouvert depuis un conteneur en yard préexistant (flux
            // dépotage historique) — comportement inchangé : le conteneur est
            // l'INPUT de l'opération.
            await tx.operationLine.create({
              data: {
                operationId: operation.id,
                yardContainerId: dto.yardContainerId,
                role: OperationLineRole.INPUT,
              },
            });
          }

          if (createdContainers.length) {
            // Rôle du conteneur nouvellement créé selon le type d'opération
            // ET selon le chemin de création (annonce vs gate-in immédiat) :
            //
            // - ICD_FULL / ICD_EMPTY : ces types PRODUISENT YardContainer[IN_YARD]
            //   (table OPERATION_TYPES du claude.md — pas d'input, le conteneur
            //   entre dans le système via cette opération) → toujours OUTPUT.
            //
            // - DEP_TRANS / DEP_STOCK annoncés (announceOnly) : le conteneur
            //   n'est PAS encore IN_YARD à la création (GATE_IN_PROGRESS,
            //   voir announceContainers()) — il ne peut donc plus être
            //   modélisé comme INPUT "consommé" immédiatement : ce serait
            //   créer un OperationLine INPUT référençant un item qui n'est
            //   pas dans le statut requis, violant la garantie que
            //   OperationsService.assertInputSatisfied() impose partout
            //   ailleurs. Traité en OUTPUT le temps que le Gate In réel (avec
            //   camion/chauffeur) confirme l'arrivée (IN_YARD) — le premier
            //   step métier ("Réception conteneur") ne devient exécutable
            //   qu'à ce moment, le conteneur agissant alors comme le vrai
            //   input du dépotage.
            //
            // - DEP_TRANS / DEP_STOCK non-annoncés (dossier mixte avec un
            //   autre type sans Gate In séparé, gateInBatch() legacy) :
            //   comportement historique conservé — le conteneur est créé
            //   IN_YARD ATOMIQUEMENT juste avant d'être rattaché comme INPUT,
            //   donc la garantie tient par construction. Cette dérogation ne
            //   s'applique QU'À la création de dossier — OperationsService.
            //   create() (ajout d'opération à un dossier EXISTANT) continue
            //   d'exiger un input préexistant.
            //
            // - EMP_EXPORT : cas particulier, voir commentaire dédié plus bas.
            const isDepotage =
              type === OperationType.DEP_TRANS ||
              type === OperationType.DEP_STOCK;
            const role =
              type === OperationType.ICD_FULL ||
              type === OperationType.ICD_EMPTY ||
              (isDepotage && announceOnly)
                ? OperationLineRole.OUTPUT
                : OperationLineRole.INPUT;

            // createMany : UNE requête pour tout le lot (un create par
            // conteneur faisait expirer la transaction au-delà d'une
            // vingtaine de conteneurs → « Internal server error »).
            await tx.operationLine.createMany({
              data: createdContainers.map(({ line, container }) => ({
                operationId: operation.id,
                yardContainerId: container.id,
                role,
                ...(line.packageCount != null
                  ? { expectedQuantity: line.packageCount }
                  : {}),
                // cargaNature n'a de sens que pour les opérations de
                // dépotage/empotage (règle §5) — DEP_TRANS/DEP_STOCK/
                // EMP_EXPORT ; laissé null pour ICD_FULL/ICD_EMPTY même si
                // le champ était renseigné par erreur côté frontend.
                ...(role === OperationLineRole.INPUT && line.cargoNature
                  ? { cargoNature: line.cargoNature }
                  : {}),
              })),
            });

            // EMP_EXPORT — décision architecturale délibérée (voir mission) :
            // le vrai INPUT d'EMP_EXPORT au sens de la table OPERATION_TYPES
            // est ShipmentLine[IN_STOCK] (la marchandise à empoter), et son
            // OUTPUT est ShipmentLine[OUT] + YardContainer[DEPARTED]. Le
            // conteneur vide créé ici (étape 2 du pipeline EMP_EXPORT :
            // "Réservation / Réception conteneur vide") N'EST PAS cet input —
            // c'est une ressource de travail que l'opération va remplir puis
            // faire sortir pleine. On le modélise quand même en OperationLine
            // role=INPUT (il est "consommé"/transformé par l'opération, et
            // finira YardContainer[DEPARTED] par la suite du pipeline), MAIS
            // on ne bloque PAS la création de l'opération sur l'absence de
            // ShipmentLine[IN_STOCK] à ce stade : au moment de la création du
            // dossier il n'existe par définition aucun stock à exporter — il
            // sera pické plus tard (étape 3 "Picking marchandise"), et rien
            // dans le modèle actuel ne permet de réserver du stock d'un AUTRE
            // dossier pour une opération de CELUI-ci (pas de champ de liaison
            // cross-dossier) : c'est un gap volontairement laissé hors
            // périmètre ici. Concrètement : `requiresInput` de
            // OPERATION_TYPE_CFG.EMP_EXPORT n'est JAMAIS consulté sur ce
            // chemin de création — seul OperationsService.create() (ajout
            // d'EMP_EXPORT à un dossier déjà doté de stock) l'applique,
            // ce qui reste le comportement voulu pour ce cas-là.
          }

          if (
            createdLines.length &&
            (type === OperationType.ENT_IN || type === OperationType.DEP_STOCK)
          ) {
            for (const l of createdLines) {
              await tx.operationLine.create({
                data: {
                  operationId: operation.id,
                  shipmentLineId: l.id,
                  role: OperationLineRole.OUTPUT,
                },
              });
            }
          }
        }

        return {
          ...file,
          operations,
          containers: createdContainers.map((c) => c.container),
          lines: createdLines,
        };
      }, BULK_TX_OPTIONS)
      .then(async (result) => {
        // WebSocket : notifie les positions occupées, APRÈS le commit de la
        // transaction (jamais depuis l'intérieur — voir gateInWithTx()).
        // Ici on ne dispose que des ids ; on relit les positions committées
        // pour construire le payload attendu par le gateway.
        if (dto.containers?.length) {
          const created = await this.prisma.yardContainer.findMany({
            where: { id: { in: result.containers.map((c) => c.id) } },
            select: { id: true, yardPosition: true },
          });
          for (const c of created) {
            if (c.yardPosition) {
              this.ymsService.emitPositionOccupied(
                tenantId,
                c.yardPosition,
                c.id,
              );
            }
          }
        }
        await this.syncCharges(result.id, tenantId);
        return result;
      });
  }

  // Ajout de cargaison (conteneurs/colis) sur un dossier EXISTANT — rattrape
  // un dossier créé sans cargaison (wizard interrompu, saisie incomplète…).
  // Réutilise EXACTEMENT la même logique de rattachement OperationLine que
  // createFile() (voir ses commentaires ci-dessus pour la justification du
  // rôle par type), mais sur l'opération INITIALE déjà existante — un
  // dossier n'a de sens qu'avec une seule "vague" de cargaison d'entrée,
  // donc on cible toujours operations[0] (la première créée), jamais une
  // opération de sortie ajoutée après coup.
  //
  // Garde de verrouillage : refusée dès que le Bon à Entrer de l'opération
  // initiale est déjà émis (bonNumber non nul). Au-delà de ce point, un
  // Gate In a pu être programmé sur la base du lot de cargaison annoncé
  // (nombre d'unités attendues) — modifier la cargaison sous les pieds de ce
  // flux romprait la cohérence pending/arrived. Avant l'émission du Bon à
  // Entrer, aucune ligne ne peut avoir avancé (stepIdx>0/slot) puisque
  // aucune étape du pipeline de type n'est accessible avant le Gate In lui-
  // même (voir OP_TYPES.steps côté frontend) — la seule garde nécessaire est
  // donc sur bonNumber.
  async addCargo(
    fileId: string,
    tenantId: string,
    operatorId: string,
    dto: AddCargoDto,
    userRole?: UserRole,
  ) {
    await this.assertFile(fileId, tenantId);

    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId },
      select: {
        tenantId: true,
        clientId: true,
        voyageCode: true,
        defaultYardId: true,
        operations: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            id: true,
            type: true,
            bonNumber: true,
            lines: {
              where: { yardContainerId: { not: null } },
              select: { stepIdx: true, done: true, slot: true },
            },
          },
        },
      },
    });
    const operation = file!.operations[0];
    // Dépotage + stockage déjà placé : les colis enregistrés après coup (ils
    // ne l'avaient pas été pendant le dépotage) sont directement EN STOCK,
    // dans la zone réservée — sinon aucune sortie d'entrepôt n'est possible.
    const placementIdx = OPERATION_TYPE_CFG.DEP_STOCK.steps.indexOf(
      'Placement & mise en stock',
    );
    const depStockPlaced =
      operation?.type === OperationType.DEP_STOCK &&
      operation.lines.some((l) => l.done || l.stepIdx > placementIdx);
    const reserved = operation?.lines
      .map((l) => l.slot as { warehouseId?: string; zoneId?: string } | null)
      .find((sl) => sl?.zoneId);
    if (!operation)
      throw new BadRequestException(
        "Ce dossier ne porte aucune opération — impossible d'y rattacher de la cargaison.",
      );
    // Après le Bon à Entrer, seuls DEX / ADMIN peuvent ajouter des
    // conteneurs (conteneur arrivé en plus du lot annoncé) : ils sont
    // annoncés « attendus » et passent ensuite le Gate In normal.
    const canAfterBon =
      userRole === UserRole.ADMIN ||
      userRole === UserRole.SUPER_ADMIN ||
      userRole === UserRole.DEX;
    if (operation.bonNumber && !canAfterBon && dto.containers?.length)
      throw new BadRequestException(
        'Le Bon à Entrer est déjà émis pour ce dossier — seul un profil DEX ou administrateur peut encore ajouter de la cargaison.',
      );

    // Même règle que createFile() : les types qui ont un Gate In séparé dans
    // le tronc commun (ICD plein/vide, dépotages) ne font qu'ANNONCER leurs
    // conteneurs (GATE_IN_PROGRESS, sans position). Auparavant addCargo()
    // passait toujours par gateInBatch() → conteneurs IN_YARD immédiatement,
    // affichés « En stock » et comptés dans le stock avant tout Gate In, et
    // étape Gate In considérée comme faite.
    // Dossier « Stockage conteneurs vides » : ses conteneurs SONT vides, quel
    // que soit leur type ISO (un 40RF vide n'a pas besoin de prise reefer) —
    // ils étaient enregistrés « sec »/« reefer », donc facturés au tarif plein
    // et refusés par les blocs faute de bloc reefer.
    if (dto.containers?.length && operation.type === OperationType.ICD_EMPTY)
      dto.containers = dto.containers.map((c) => ({
        ...c,
        containerType: ContainerType.EMPTY,
      }));
    const announceOnly = (
      [
        OperationType.ICD_FULL,
        OperationType.ICD_EMPTY,
        OperationType.DEP_TRANS,
        OperationType.DEP_STOCK,
      ] as OperationType[]
    ).includes(operation.type);
    if (dto.containers?.length) {
      if (announceOnly && !file!.defaultYardId)
        throw new BadRequestException(
          "Ce dossier n'a pas de yard cible — impossible d'annoncer des conteneurs.",
        );
      if (!announceOnly && !operatorId)
        throw new BadRequestException(
          'Utilisateur requis pour créer un conteneur (gate-in) sur ce dossier.',
        );
    }

    if (dto.containers?.length) {
      const numbers = dto.containers.map((c) =>
        c.containerNumber.toUpperCase(),
      );
      const dup = numbers.find((n, i) => numbers.indexOf(n) !== i);
      if (dup)
        throw new BadRequestException(
          `Le conteneur ${dup} apparaît plusieurs fois dans l'ajout de cargaison.`,
        );
      await this.ymsService.assertContainerNumbersFree(tenantId, numbers);
    }

    return this.prisma
      .$transaction(async (tx) => {
        // Gate-in du lot en UNE fois — voir le commentaire de gateInBatch()
        // (allocation en lot hors transaction, création groupée dedans) et de
        // createFile() (même chemin, même justification P2028).
        const announced =
          announceOnly && dto.containers?.length
            ? await this.ymsService.announceContainers(
                tenantId,
                file!.defaultYardId!,
                dto.containers.map((line) => ({
                  containerNumber: line.containerNumber,
                  isoTypeCode: line.isoTypeCode,
                  sizeFt: line.sizeFt,
                  containerType: line.containerType,
                  grossWeightKg: line.grossWeightKg,
                  shippingLine: line.shippingLine,
                  voyageCode: file!.voyageCode,
                  customsHold: line.customsHold,
                  isDangerousGoods: line.isDangerousGoods,
                  sealNumber: line.sealNumber,
                  clientId: file!.clientId ?? undefined,
                  notes: line.bl ? `BL: ${line.bl}` : undefined,
                })),
                tx,
              )
            : [];
        const gateInResults = !announceOnly && dto.containers?.length
          ? await this.ymsService.gateInBatch(
              tenantId,
              operatorId,
              dto.containers.map((line) => ({
                containerNumber: line.containerNumber,
                isoTypeCode: line.isoTypeCode,
                sizeFt: line.sizeFt,
                containerType: line.containerType,
                grossWeightKg: line.grossWeightKg,
                shippingLine: line.shippingLine,
                voyageCode: file!.voyageCode,
                customsHold: line.customsHold,
                isDangerousGoods: line.isDangerousGoods,
                sealNumber: line.sealNumber,
                clientId: file!.clientId ?? undefined,
                yardId: file!.defaultYardId ?? undefined,
                notes: line.bl ? `BL: ${line.bl}` : undefined,
              })),
              tx,
            )
          : [];
        const createdContainers: {
          line: InlineGateInLineDto;
          container: { id: string };
          position: {
            id: string;
            yardId: string;
            block: string;
            bay: number;
            row: number;
            tier: number;
          } | null;
        }[] = announceOnly
          ? announced.map((container, idx) => ({
              line: dto.containers![idx],
              container,
              position: null,
            }))
          : gateInResults.map((r, idx) => ({
              line: dto.containers![idx],
              container: r.container,
              position: r.position,
            }));

        // Colis ENT_IN : créés PENDING, comme à la création du dossier
        // (voir createFile()) — IN_STOCK au Gate In réel.
        const createdLines: { id: string }[] = [];
        for (const line of dto.lines ?? []) {
          const created = await tx.shipmentLine.create({
            data: {
              shipmentFileId: fileId,
              tenantId,
              packageRef: line.packageRef,
              packageTypeCode: line.packageTypeCode ?? 'OTHER',
              packageCount: line.packageCount,
              quantity: line.quantity ?? 1,
              weightKg: line.weightKg,
              volumeM3: line.volumeM3,
              surfaceM2: line.surfaceM2,
              description: line.description,
              ...(line.yardId
                ? { yardId: line.yardId }
                : depStockPlaced && reserved?.warehouseId
                  ? { yardId: reserved.warehouseId }
                  : {}),
              ...(line.zoneId
                ? { zoneId: line.zoneId }
                : depStockPlaced && reserved?.zoneId
                  ? { zoneId: reserved.zoneId }
                  : {}),
              ...(depStockPlaced ? { status: ShipmentLineStatus.IN_STOCK } : {}),
            },
          });
          createdLines.push(created);
        }

        if (createdContainers.length) {
          // Même règle de rôle que createFile() : ICD et dépotages annoncés
          // → OUTPUT (le conteneur arrive au Gate In), sinon INPUT.
          const isDepotage =
            operation.type === OperationType.DEP_TRANS ||
            operation.type === OperationType.DEP_STOCK;
          const role =
            operation.type === OperationType.ICD_FULL ||
            operation.type === OperationType.ICD_EMPTY ||
            (isDepotage && announceOnly)
              ? OperationLineRole.OUTPUT
              : OperationLineRole.INPUT;
          await tx.operationLine.createMany({
            data: createdContainers.map(({ line, container }) => ({
              operationId: operation.id,
              yardContainerId: container.id,
              role,
              ...(line.packageCount != null
                ? { expectedQuantity: line.packageCount }
                : {}),
              ...((role === OperationLineRole.INPUT || isDepotage) &&
              line.cargoNature
                ? { cargoNature: line.cargoNature }
                : {}),
            })),
          });
        }

        if (
          createdLines.length &&
          (operation.type === OperationType.ENT_IN ||
            operation.type === OperationType.DEP_STOCK)
        ) {
          for (const l of createdLines) {
            await tx.operationLine.create({
              data: {
                operationId: operation.id,
                shipmentLineId: l.id,
                role: OperationLineRole.OUTPUT,
                // Dépotage déjà terminé : le colis ne repasse pas les étapes.
                ...(depStockPlaced
                  ? {
                      stepIdx: OPERATION_TYPE_CFG.DEP_STOCK.steps.length,
                      done: true,
                    }
                  : {}),
              },
            });
          }
          // Sortie d'entrepôt déjà ouverte : les nouveaux colis la rejoignent.
          if (depStockPlaced) {
            const exit = await tx.operation.findFirst({
              where: {
                shipmentFileId: fileId,
                type: OperationType.ENT_OUT,
                status: { notIn: ['SORTI', 'DOSSIER_CLOS'] },
              },
              select: { id: true },
              orderBy: { createdAt: 'desc' },
            });
            if (exit)
              await tx.operationLine.createMany({
                data: createdLines.map((l) => ({
                  operationId: exit.id,
                  shipmentLineId: l.id,
                  role: OperationLineRole.INPUT,
                })),
              });
          }
        }

        return { containers: createdContainers, lines: createdLines };
      }, BULK_TX_OPTIONS)
      .then(async (result) => {
        for (const { container, position } of result.containers) {
          if (!position) continue;
          this.ymsService.emitPositionOccupied(
            tenantId,
            position,
            container.id,
          );
        }
        // Nouvelle cargaison → quantités des charges (EVP, conteneurs…).
        await this.syncCharges(fileId, tenantId);
        return {
          containers: result.containers.map((c) => c.container),
          lines: result.lines,
        };
      });
  }

  // Correction d'un conteneur du dossier (n° mal saisi, type, plomb…).
  // Le conteneur est référencé par yardContainerId partout (OperationLine),
  // la correction se répercute donc sur toutes les opérations du dossier.
  // Avant le Bon à Entrer : tout agent ; après : DEX/ADMIN uniquement (le
  // bon a déjà circulé avec l'ancien n°). Refusé une fois sorti du site.
  async updateCargoContainer(
    fileId: string,
    containerId: string,
    tenantId: string,
    userRole: UserRole,
    dto: UpdateCargoContainerDto,
  ) {
    await this.assertFile(fileId, tenantId);
    const link = await this.prisma.operationLine.findFirst({
      where: {
        yardContainerId: containerId,
        operation: { shipmentFileId: fileId, tenantId },
      },
      select: { operation: { select: { bonNumber: true } } },
    });
    const container = await this.prisma.yardContainer.findFirst({
      where: { id: containerId, tenantId },
    });
    if (!link || !container)
      throw new NotFoundException("Ce conteneur n'appartient pas au dossier.");
    if (container.status === YardContainerStatus.DEPARTED)
      throw new BadRequestException(
        'Ce conteneur est déjà sorti du site — sa fiche ne peut plus être corrigée.',
      );
    const privileged: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.DEX,
    ];
    const bonIssued = await this.prisma.operation.count({
      where: { shipmentFileId: fileId, tenantId, bonNumber: { not: null } },
    });
    if (bonIssued && !privileged.includes(userRole))
      throw new ForbiddenException(
        'Le Bon à Entrer est émis : seule la DEX ou un administrateur peut corriger la cargaison.',
      );

    const number = dto.containerNumber?.trim().toUpperCase();
    if (number && number !== container.containerNumber)
      await this.ymsService.assertContainerNumberFree(
        tenantId,
        number,
        containerId,
      );

    // BL : stocké dans notes sous la forme « BL: … » (voir createFile()).
    let notes: string | undefined;
    if (dto.bl !== undefined) {
      const rest = (container.notes ?? '')
        .split('\n')
        .filter((l) => !/^BL:/.test(l))
        .join('\n')
        .trim();
      const bl = dto.bl.trim();
      notes = [bl ? `BL: ${bl}` : '', rest].filter(Boolean).join('\n');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.yardContainer.update({
        where: { id: containerId },
        data: {
          ...(number ? { containerNumber: number } : {}),
          ...(dto.isoTypeCode !== undefined
            ? { isoTypeCode: dto.isoTypeCode }
            : {}),
          // Taille choisie explicitement, sinon déduite du nouveau code ISO.
          ...(dto.sizeFt !== undefined || dto.isoTypeCode !== undefined
            ? {
                sizeFt:
                  dto.sizeFt ??
                  sizeForType(dto.isoTypeCode, container.sizeFt),
              }
            : {}),
          ...(dto.containerType !== undefined
            ? { containerType: dto.containerType }
            : {}),
          ...(dto.isDangerousGoods !== undefined
            ? { isDangerousGoods: dto.isDangerousGoods }
            : {}),
          ...(dto.sealNumber !== undefined
            ? { sealNumber: dto.sealNumber.trim() || null }
            : {}),
          ...(dto.grossWeightKg !== undefined
            ? { grossWeightKg: dto.grossWeightKg }
            : {}),
          ...(notes !== undefined ? { notes: notes || null } : {}),
        },
      });
      // Nombre de colis attendus : porté par les lignes d'opération du
      // conteneur DANS CE dossier.
      if (dto.packageCount !== undefined) {
        const opLines = await tx.operationLine.findMany({
          where: {
            yardContainerId: containerId,
            operation: { shipmentFileId: fileId, tenantId },
          },
          select: { id: true, quantity: true, expectedQuantity: true },
        });
        for (const ol of opLines) {
          // Pointage déjà fait SANS écart (constaté = ancien attendu, ou
          // pointé à 0/1 faute de nombre connu) : il suit le nouveau nombre.
          // Un pointage avec un écart réel est conservé tel quel.
          const followsExpected =
            ol.quantity == null ||
            ol.quantity === ol.expectedQuantity ||
            (ol.expectedQuantity == null && ol.quantity <= 1);
          await tx.operationLine.update({
            where: { id: ol.id },
            data: {
              expectedQuantity: dto.packageCount,
              ...(followsExpected && ol.quantity != null
                ? { quantity: dto.packageCount }
                : {}),
            },
          });
        }
      }
      // Copie texte du n° sur la ligne de pré-gate d'origine.
      if (number && container.preGateLineId)
        await tx.preGateLine.updateMany({
          where: { id: container.preGateLineId },
          data: { containerNumber: number },
        });
      return row;
    });

    // Taille / type corrigés → charges par taille (20'/40', vide/plein).
    if (
      dto.sizeFt !== undefined ||
      dto.containerType !== undefined ||
      dto.isoTypeCode !== undefined
    )
      await this.syncCharges(fileId, tenantId);

    return updated;
  }

  // Étape 2 — Suivi douanier : complète déclaration + calcule sommier si EF
  async updateCustoms(id: string, tenantId: string, dto: CustomsUpdateDto) {
    await this.assertFile(id, tenantId);

    let sommierExpiryDate: Date | undefined;
    if (dto.customsDeclDate) {
      const regimeCode =
        dto.storageRegimeCode ??
        (
          await this.prisma.shipmentFile.findFirst({
            where: { id, tenantId },
            select: { storageRegimeCode: true },
          })
        )?.storageRegimeCode ??
        undefined;
      if (regimeCode) {
        const regime = await this.prisma.storageRegimeRef.findFirst({
          where: { tenantId, code: regimeCode },
          select: { sommierDays: true },
        });
        if (regime?.sommierDays) {
          const base = new Date(dto.customsDeclDate);
          sommierExpiryDate = new Date(base);
          sommierExpiryDate.setDate(
            sommierExpiryDate.getDate() + regime.sommierDays,
          );
        }
      }
    }

    const updated = await this.prisma.shipmentFile.update({
      where: { id },
      data: {
        ...(dto.storageRegimeCode !== undefined
          ? { storageRegimeCode: dto.storageRegimeCode }
          : {}),
        ...(dto.customsDeclNumber !== undefined
          ? { customsDeclNumber: dto.customsDeclNumber }
          : {}),
        ...(dto.customsDeclDate
          ? { customsDeclDate: new Date(dto.customsDeclDate) }
          : {}),
        ...(sommierExpiryDate ? { sommierExpiryDate } : {}),
        ...(dto.invoiceNumber !== undefined
          ? { invoiceNumber: dto.invoiceNumber }
          : {}),
        ...(dto.transportDocNumber !== undefined
          ? { transportDocNumber: dto.transportDocNumber }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        status: ShipmentFileStatus.CUSTOMS_PENDING,
      },
      select: FILE_SELECT,
    });

    if (sommierExpiryDate) {
      void this.alertsService.scheduleSommierAlerts(
        updated.id,
        sommierExpiryDate,
        tenantId,
        updated.voyageCode,
        updated.clientRef ?? null,
      );
    }

    return updated;
  }

  // Réception partielle — crée un ShipmentReceipt et passe les lignes concernées en IN_STOCK
  async receiveShipment(id: string, tenantId: string, dto: ReceiveShipmentDto) {
    await this.assertFile(id, tenantId);
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: { status: true },
    });
    if (file!.status === ShipmentFileStatus.FULLY_OUT) {
      throw new BadRequestException(
        'Impossible de réceptionner un dossier entièrement sorti.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Créer l'enregistrement de réception
      const receipt = await tx.shipmentReceipt.create({
        data: {
          shipmentFileId: id,
          entryDate: dto.entryDate ? new Date(dto.entryDate) : new Date(),
          transportDocNumber: dto.transportDocNumber,
          driverName: dto.driverName,
          driverPhone: dto.driverPhone,
          truckPlate: dto.truckPlate,
          targetLocation: dto.targetLocation,
          notes: dto.notes,
          comments: dto.comments,
        },
      });

      if (dto.lines?.length) {
        const existing = dto.lines.filter((l) => l.id);
        const toCreate = dto.lines.filter((l) => !l.id);

        // Mettre à jour les lignes existantes (PENDING → IN_STOCK + lier au receipt)
        for (const l of existing) {
          await tx.shipmentLine.update({
            where: { id: l.id },
            data: {
              packageRef: l.packageRef,
              packageTypeCode: l.packageTypeCode ?? 'OTHER',
              packageCount: l.packageCount,
              quantity: l.quantity,
              description: l.description,
              weightKg: l.weightKg,
              volumeM3: l.volumeM3,
              surfaceM2: l.surfaceM2,
              receiptId: receipt.id,
              status: ShipmentLineStatus.IN_STOCK,
            },
          });
        }

        // Créer les nouvelles lignes directement IN_STOCK liées au receipt
        if (toCreate.length) {
          await tx.shipmentLine.createMany({
            data: toCreate.map((l) => ({
              shipmentFileId: id,
              tenantId,
              packageRef: l.packageRef,
              packageTypeCode: l.packageTypeCode ?? 'OTHER',
              packageCount: l.packageCount,
              quantity: l.quantity,
              description: l.description,
              weightKg: l.weightKg,
              volumeM3: l.volumeM3,
              surfaceM2: l.surfaceM2,
              receiptId: receipt.id,
              status: ShipmentLineStatus.IN_STOCK,
            })),
          });
        }
      }

      // Mettre à jour le statut du dossier selon l'état des lignes
      const allLines = await tx.shipmentLine.findMany({
        where: { shipmentFileId: id },
        select: { status: true },
      });
      const hasPending = allLines.some(
        (l) => l.status === ShipmentLineStatus.PENDING,
      );
      const hasInStock = allLines.some(
        (l) =>
          l.status === ShipmentLineStatus.IN_STOCK ||
          l.status === ShipmentLineStatus.RESERVED,
      );

      const currentStatus = file!.status;
      let newStatus: ShipmentFileStatus;
      if (hasPending && hasInStock) {
        newStatus = ShipmentFileStatus.PARTIAL_RECEIVED;
      } else if (!hasPending) {
        // Toutes les lignes sont reçues — garder IN_STOCK/PARTIAL_OUT si déjà passé, sinon PENDING_PUTAWAY
        newStatus =
          currentStatus === ShipmentFileStatus.IN_STOCK ||
          currentStatus === ShipmentFileStatus.PARTIAL_OUT
            ? currentStatus
            : ShipmentFileStatus.PENDING_PUTAWAY;
      } else {
        newStatus = currentStatus;
      }

      await tx.shipmentFile.update({
        where: { id },
        data: { status: newStatus },
      });
    });

    return this.getFile(id, tenantId);
  }

  // Annulation d'une réception — remet les lignes en PENDING, supprime le receipt, recalcule le statut dossier
  async cancelReceipt(receiptId: string, tenantId: string) {
    const receipt = await this.prisma.shipmentReceipt.findFirst({
      where: { id: receiptId },
      include: {
        shipmentFile: { select: { id: true, tenantId: true, status: true } },
        lines: { select: { id: true, status: true } },
      },
    });
    if (!receipt) throw new NotFoundException('Réception introuvable.');
    if (receipt.shipmentFile.tenantId !== tenantId)
      throw new NotFoundException('Réception introuvable.');

    const anyLineOut = receipt.lines.some(
      (l) => l.status === 'OUT' || l.status === 'RESERVED',
    );
    if (anyLineOut)
      throw new BadRequestException(
        "Impossible d'annuler : certains colis de cette réception ont déjà été sortis.",
      );

    const fileId = receipt.shipmentFile.id;

    await this.prisma.$transaction(async (tx) => {
      // Remettre toutes les lignes de cette réception en PENDING
      await tx.shipmentLine.updateMany({
        where: { receiptId, status: ShipmentLineStatus.IN_STOCK },
        data: { status: ShipmentLineStatus.PENDING, receiptId: null },
      });

      // Supprimer le receipt
      await tx.shipmentReceipt.delete({ where: { id: receiptId } });

      // Recalculer le statut du dossier
      const allLines = await tx.shipmentLine.findMany({
        where: { shipmentFileId: fileId },
        select: { status: true },
      });
      const hasPending = allLines.some(
        (l) => l.status === ShipmentLineStatus.PENDING,
      );
      const hasInStock = allLines.some(
        (l) =>
          l.status === ShipmentLineStatus.IN_STOCK ||
          l.status === ShipmentLineStatus.RESERVED,
      );

      let newStatus: ShipmentFileStatus;
      if (hasPending && hasInStock) {
        newStatus = ShipmentFileStatus.PARTIAL_RECEIVED;
      } else if (hasPending && !hasInStock) {
        // Toutes les lignes repassées en PENDING → retour à CUSTOMS_PENDING
        newStatus = ShipmentFileStatus.CUSTOMS_PENDING;
      } else {
        newStatus = receipt.shipmentFile.status;
      }

      await tx.shipmentFile.update({
        where: { id: fileId },
        data: { status: newStatus },
      });
    });

    return this.getFile(fileId, tenantId);
  }

  // Étape 4 — Gestionnaire de stock confirme la mise en place → IN_STOCK
  async confirmPutaway(
    id: string,
    tenantId: string,
    operatorId: string,
    dto: PutawayConfirmDto,
  ) {
    await this.assertFile(id, tenantId);

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentFile.update({
        where: { id },
        data: {
          status: ShipmentFileStatus.IN_STOCK,
          ...(dto.putawayNote !== undefined
            ? { putawayNote: dto.putawayNote }
            : {}),
          putawayConfirmedAt: new Date(),
          putawayConfirmedBy: operatorId,
        },
      });

      // Mettre à jour yard/zone ligne par ligne
      if (dto.lines?.length) {
        for (const line of dto.lines) {
          await tx.shipmentLine.update({
            where: { id: line.id },
            data: {
              ...(line.yardId !== undefined
                ? { yardId: line.yardId || null }
                : {}),
              ...(line.zoneId !== undefined
                ? { zoneId: line.zoneId || null }
                : {}),
            },
          });
        }
      }
    });

    return this.getFile(id, tenantId);
  }

  async updateFile(id: string, tenantId: string, dto: UpdateShipmentFileDto) {
    await this.assertFile(id, tenantId);

    let sommierExpiryDate: Date | undefined;
    if (dto.storageRegimeCode && dto.customsDeclDate) {
      const regime = await this.prisma.storageRegimeRef.findUnique({
        where: { tenantId_code: { tenantId, code: dto.storageRegimeCode } },
        select: { sommierDays: true },
      });
      if (regime?.sommierDays) {
        const base = new Date(dto.customsDeclDate);
        sommierExpiryDate = new Date(base);
        sommierExpiryDate.setDate(
          sommierExpiryDate.getDate() + regime.sommierDays,
        );
      }
    }

    return this.prisma.shipmentFile.update({
      where: { id },
      data: {
        ...(dto.voyageCode ? { voyageCode: dto.voyageCode } : {}),
        ...(dto.shipmentTypeCode
          ? { shipmentTypeCode: dto.shipmentTypeCode }
          : {}),
        ...(dto.storageRegimeCode
          ? { storageRegimeCode: dto.storageRegimeCode }
          : {}),
        ...(dto.clientId !== undefined
          ? { clientId: dto.clientId || null }
          : {}),
        ...(dto.clientRef !== undefined ? { clientRef: dto.clientRef } : {}),
        ...(dto.invoiceNumber !== undefined
          ? { invoiceNumber: dto.invoiceNumber }
          : {}),
        ...(dto.transportDocNumber !== undefined
          ? { transportDocNumber: dto.transportDocNumber }
          : {}),
        ...(dto.customsDeclNumber !== undefined
          ? { customsDeclNumber: dto.customsDeclNumber }
          : {}),
        ...(dto.customsDeclDate
          ? { customsDeclDate: new Date(dto.customsDeclDate) }
          : {}),
        ...(sommierExpiryDate ? { sommierExpiryDate } : {}),
        ...(dto.eta ? { eta: new Date(dto.eta) } : {}),
        ...(dto.entryDate ? { entryDate: new Date(dto.entryDate) } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.defaultYardId !== undefined
          ? { defaultYardId: dto.defaultYardId }
          : {}),
        ...(dto.vatApplicable !== undefined
          ? { vatApplicable: dto.vatApplicable }
          : {}),
      },
      select: FILE_SELECT,
    });
  }

  // Moyen de règlement (espèces/virement/chèque) — modifiable après création
  // depuis l'onglet Finance (TabFinance, dossier-finance.jsx). Crée un
  // Payment à la volée si le dossier n'en a jamais eu (créé sans
  // paymentTerm) — termType ON_CREDIT par défaut, cohérent avec l'absence
  // de contrainte de blocage sortie tant qu'aucun mode AT_PICKUP n'est
  // explicitement choisi.
  async updatePaymentMethod(
    id: string,
    tenantId: string,
    method: PaymentMethod,
  ) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: { id: true, paymentId: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    if (file.paymentId) {
      await this.prisma.payment.update({
        where: { id: file.paymentId },
        data: { method },
      });
    } else {
      const payment = await this.prisma.payment.create({
        data: { tenantId, termType: 'ON_CREDIT', method },
      });
      await this.prisma.shipmentFile.update({
        where: { id },
        data: { paymentId: payment.id },
      });
    }

    return this.getFile(id, tenantId);
  }

  // ── Documents (Étape 6 — Contrôle documentaire, §5) ─────────────────────

  // Upsert par nom : la liste des pièces REQUISES est un référentiel
  // frontend (OP_TYPES[type].docs) qui peut évoluer ou ne pas avoir été
  // seedée à la création (dossiers déjà ouverts avant cette fonctionnalité,
  // ou pièce ajoutée après coup) — on crée la ligne à la volée si absente,
  // au lieu de refuser un nom inconnu.
  async toggleDocument(
    fileId: string,
    tenantId: string,
    name: string,
    attached: boolean,
    userId?: string,
  ) {
    await this.assertFile(fileId, tenantId);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Nom de document requis.');

    return this.prisma.shipmentFileDocument.upsert({
      where: { shipmentFileId_name: { shipmentFileId: fileId, name: trimmed } },
      create: {
        shipmentFileId: fileId,
        tenantId,
        name: trimmed,
        attached,
        ...(attached ? { attachedAt: new Date(), attachedById: userId } : {}),
      },
      update: {
        attached,
        ...(attached
          ? { attachedAt: new Date(), attachedById: userId }
          : { attachedAt: null, attachedById: null }),
      },
      select: {
        id: true,
        name: true,
        attached: true,
        attachedAt: true,
        attachedById: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  }

  async listDocuments(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    return this.prisma.shipmentFileDocument.findMany({
      where: { shipmentFileId: fileId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        attached: true,
        attachedAt: true,
        attachedById: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  }

  async uploadDocument(
    fileId: string,
    tenantId: string,
    name: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    await this.assertFile(fileId, tenantId);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Nom de document requis.');

    const existing = await this.prisma.shipmentFileDocument.findUnique({
      where: { shipmentFileId_name: { shipmentFileId: fileId, name: trimmed } },
      select: { blobName: true },
    });
    const blobName = await this.documentStorage.upload(tenantId, fileId, file);
    let document;
    try {
      document = await this.prisma.shipmentFileDocument.upsert({
        where: {
          shipmentFileId_name: { shipmentFileId: fileId, name: trimmed },
        },
        create: {
          shipmentFileId: fileId,
          tenantId,
          name: trimmed,
          attached: true,
          attachedAt: new Date(),
          attachedById: userId,
          blobName,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
        update: {
          attached: true,
          attachedAt: new Date(),
          attachedById: userId,
          blobName,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
        select: {
          id: true,
          name: true,
          attached: true,
          attachedAt: true,
          attachedById: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
        },
      });
    } catch (error) {
      await this.documentStorage.delete(blobName);
      throw error;
    }
    if (existing?.blobName && existing.blobName !== blobName)
      await Promise.allSettled([this.documentStorage.delete(existing.blobName)]);
    return document;
  }

  async downloadDocument(fileId: string, documentId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    const document = await this.prisma.shipmentFileDocument.findFirst({
      where: { id: documentId, shipmentFileId: fileId, tenantId },
      select: {
        blobName: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
    if (!document?.blobName)
      throw new NotFoundException('Fichier joint introuvable.');
    const blob = await this.documentStorage.download(document.blobName);
    return {
      ...document,
      stream: blob.stream,
      mimeType: document.mimeType || blob.contentType,
      sizeBytes: document.sizeBytes || blob.contentLength,
    };
  }

  async uploadInspectionPhoto(
    fileId: string,
    tenantId: string,
    file: Express.Multer.File,
  ) {
    await this.assertFile(fileId, tenantId);
    if (!file?.mimetype?.startsWith('image/'))
      throw new BadRequestException('Une image est requise.');
    const blobName = await this.documentStorage.uploadInspection(
      tenantId,
      fileId,
      file,
    );
    return {
      blobName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }

  async downloadInspectionPhoto(
    fileId: string,
    tenantId: string,
    blobName: string,
  ) {
    await this.assertFile(fileId, tenantId);
    const prefix = `${tenantId}/${fileId}/inspections/`;
    if (!blobName.startsWith(prefix))
      throw new NotFoundException('Photo d’inspection introuvable.');
    return this.documentStorage.download(blobName);
  }

  async deleteDocument(fileId: string, documentId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    const document = await this.prisma.shipmentFileDocument.findFirst({
      where: { id: documentId, shipmentFileId: fileId, tenantId },
      select: { id: true, name: true, blobName: true },
    });
    if (!document) throw new NotFoundException('Document introuvable.');
    await this.documentStorage.delete(document.blobName);
    await this.prisma.shipmentFileDocument.delete({
      where: { id: document.id },
    });
    return { deleted: true, name: document.name };
  }

  async listAudit(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    return this.prisma.shipmentFileAuditLog.findMany({
      where: { shipmentFileId: fileId, tenantId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  // ── ShipmentLines ────────────────────────────────────────────────────────

  async listLines(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    return this.prisma.shipmentLine.findMany({
      where: { shipmentFileId: fileId },
      orderBy: { createdAt: 'asc' },
      include: {
        yard: { select: { id: true, code: true, name: true } },
        zone: { select: { id: true, code: true, label: true } },
        packageType: { select: { code: true, label: true } },
      },
    });
  }

  async addLine(fileId: string, tenantId: string, dto: CreateShipmentLineDto) {
    await this.assertFile(fileId, tenantId);
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId },
      select: { tenantId: true },
    });
    return this.prisma.shipmentLine.create({
      data: {
        shipmentFileId: fileId,
        tenantId: file!.tenantId,
        packageRef: dto.packageRef,
        packageTypeCode: dto.packageTypeCode ?? 'OTHER',
        packageCount: dto.packageCount,
        quantity: dto.quantity ?? 1,
        weightKg: dto.weightKg,
        volumeM3: dto.volumeM3,
        surfaceM2: dto.surfaceM2,
        ...(dto.yardId ? { yardId: dto.yardId } : {}),
        ...(dto.zoneId ? { zoneId: dto.zoneId } : {}),
      },
    });
  }

  async updateLine(
    lineId: string,
    tenantId: string,
    dto: UpdateShipmentLineDto,
  ) {
    const line = await this.prisma.shipmentLine.findUnique({
      where: { id: lineId },
      include: { shipmentFile: true },
    });
    if (!line || line.shipmentFile.tenantId !== tenantId)
      throw new NotFoundException('Ligne introuvable.');

    const updated = await this.prisma.shipmentLine.update({
      where: { id: lineId },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.packageRef !== undefined ? { packageRef: dto.packageRef } : {}),
        ...(dto.packageTypeCode !== undefined
          ? { packageTypeCode: dto.packageTypeCode }
          : {}),
        ...(dto.packageCount !== undefined
          ? { packageCount: dto.packageCount }
          : {}),
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}),
        ...(dto.volumeM3 !== undefined ? { volumeM3: dto.volumeM3 } : {}),
        ...(dto.surfaceM2 !== undefined ? { surfaceM2: dto.surfaceM2 } : {}),
        ...(dto.yardId !== undefined ? { yardId: dto.yardId } : {}),
        ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
        // Présent dans le DTO mais jamais écrit jusqu'ici.
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
      include: {
        yard: { select: { id: true, code: true, name: true } },
        zone: { select: { id: true, code: true, label: true } },
      },
    });

    // Recalcule le statut du dossier parent si une ligne change de statut
    if (dto.status) {
      await this.recalcFileStatus(line.shipmentFileId);
    }

    return updated;
  }

  async deleteLine(lineId: string, tenantId: string) {
    const line = await this.prisma.shipmentLine.findUnique({
      where: { id: lineId },
      include: { shipmentFile: true },
    });
    if (!line || line.shipmentFile.tenantId !== tenantId)
      throw new NotFoundException('Ligne introuvable.');
    if (line.status === ShipmentLineStatus.OUT)
      throw new BadRequestException(
        'Impossible de supprimer un colis déjà sorti.',
      );

    await this.prisma.shipmentLine.delete({ where: { id: lineId } });
    await this.recalcFileStatus(line.shipmentFileId);
    return { deleted: true };
  }

  // ── ExitMovements ────────────────────────────────────────────────────────

  async createExitMovement(
    fileId: string,
    tenantId: string,
    dto: CreateExitMovementDto,
  ) {
    await this.assertFile(fileId, tenantId);

    if (!dto.exitLines?.length)
      throw new BadRequestException(
        'Au moins une ligne doit être sélectionnée.',
      );

    // Charge les lignes concernées avec leur état courant
    const lineIds = dto.exitLines.map((el) => el.shipmentLineId);
    const dbLines = await this.prisma.shipmentLine.findMany({
      where: { id: { in: lineIds }, shipmentFileId: fileId },
      select: { id: true, quantity: true, quantityOut: true, status: true },
    });

    if (dbLines.length !== lineIds.length)
      throw new BadRequestException('Une ou plusieurs lignes sont invalides.');

    // Valide les quantités demandées
    for (const el of dto.exitLines) {
      const line = dbLines.find((l) => l.id === el.shipmentLineId)!;
      const remaining = line.quantity - line.quantityOut;
      if (line.status === ShipmentLineStatus.OUT)
        throw new BadRequestException(
          `Ligne ${line.id} déjà entièrement sortie.`,
        );
      if (el.quantityOut < 1 || el.quantityOut > remaining)
        throw new BadRequestException(
          `Quantité invalide pour la ligne ${line.id} : demandé ${el.quantityOut}, disponible ${remaining}.`,
        );
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      // Opération porteuse de cette sortie (voir claude.md, OPÉRATIONS ET PIPELINE)
      const operation = await tx.operation.create({
        data: {
          shipmentFileId: fileId,
          tenantId,
          type: 'ENT_OUT',
          status: 'ORDRE_SORTIE',
        },
      });

      // Crée le mouvement de sortie
      const mov = await tx.exitMovement.create({
        data: {
          shipmentFileId: fileId,
          operationId: operation.id,
          tenantId,
          status: 'DRAFT',
          deliveryOrderRef: dto.deliveryOrderRef,
          exitDate: dto.exitDate ? new Date(dto.exitDate) : undefined,
          exitShipmentTypeCode: dto.exitShipmentTypeCode,
          exitVoyageCode: dto.exitVoyageCode,
          exitCustomsDecl: dto.exitCustomsDecl,
          exitTransportDoc: dto.exitTransportDoc,
          truckPlate: dto.truckPlate,
          driverName: dto.driverName,
          driverPhone: dto.driverPhone,
          notes: dto.notes,
        },
      });

      // Crée les lignes pivot + met à jour quantityOut et statut de chaque ShipmentLine
      for (const el of dto.exitLines) {
        const line = dbLines.find((l) => l.id === el.shipmentLineId)!;
        const newQtyOut = line.quantityOut + el.quantityOut;
        const newStatus =
          newQtyOut >= line.quantity
            ? ShipmentLineStatus.OUT
            : ShipmentLineStatus.PARTIAL_OUT;

        await tx.exitMovementLine.create({
          data: {
            exitMovementId: mov.id,
            shipmentLineId: el.shipmentLineId,
            quantityOut: el.quantityOut,
            note: el.note,
          },
        });

        await tx.operationLine.create({
          data: {
            operationId: operation.id,
            shipmentLineId: el.shipmentLineId,
            role: 'OUTPUT',
            quantity: el.quantityOut,
          },
        });

        await tx.shipmentLine.update({
          where: { id: el.shipmentLineId },
          data: { quantityOut: newQtyOut, status: newStatus },
        });
      }

      return mov;
    });

    await this.recalcFileStatus(fileId);

    return this.prisma.exitMovement.findUnique({
      where: { id: movement.id },
      include: { exitLines: { include: { shipmentLine: true } } },
    });
  }

  // Confirme un mouvement de sortie (Étape 3 — gate physique)
  async confirmExitMovement(
    movId: string,
    tenantId: string,
    operatorId: string,
    dto: ConfirmExitMovementDto,
  ) {
    const mov = await this.prisma.exitMovement.findFirst({
      where: { id: movId, tenantId },
      select: { id: true, status: true },
    });
    if (!mov) throw new NotFoundException('Mouvement de sortie introuvable.');
    if (mov.status !== 'DRAFT')
      throw new BadRequestException('Ce mouvement est déjà confirmé.');

    return this.prisma.exitMovement.update({
      where: { id: movId },
      data: {
        status: 'CONFIRMED',
        truckPlate: dto.truckPlate ?? undefined,
        driverName: dto.driverName ?? undefined,
        driverPhone: dto.driverPhone ?? undefined,
        notes: dto.notes ?? undefined,
      },
      include: { exitLines: { include: { shipmentLine: true } } },
    });
  }

  async updateExitCustomsDecl(
    movId: string,
    tenantId: string,
    exitCustomsDecl: string,
  ) {
    const mov = await this.prisma.exitMovement.findFirst({
      where: { id: movId, tenantId },
      select: { id: true, status: true },
    });
    if (!mov) throw new NotFoundException('Mouvement de sortie introuvable.');
    if (mov.status !== 'CONFIRMED')
      throw new BadRequestException(
        'Le bon doit être confirmé pour saisir la déclaration.',
      );

    return this.prisma.exitMovement.update({
      where: { id: movId },
      data: { exitCustomsDecl },
      include: { exitLines: { include: { shipmentLine: true } } },
    });
  }

  async gateOutExitMovement(
    movId: string,
    tenantId: string,
    operatorId: string,
    dto: ConfirmExitMovementDto,
  ) {
    const mov = await this.prisma.exitMovement.findFirst({
      where: { id: movId, tenantId },
      select: {
        id: true,
        status: true,
        operationId: true,
        shipmentFile: {
          select: { payment: { select: { termType: true, status: true } } },
        },
      },
    });
    if (!mov) throw new NotFoundException('Mouvement de sortie introuvable.');
    if (mov.status !== 'CONFIRMED')
      throw new BadRequestException(
        'Le bon doit être confirmé avant le Gate OUT.',
      );
    this.paymentsService.assertGateOutAllowed(mov.shipmentFile.payment);

    if (mov.operationId) {
      await this.prisma.operation.update({
        where: { id: mov.operationId },
        data: { status: 'SORTI', closedAt: new Date() },
      });
    }

    return this.prisma.exitMovement.update({
      where: { id: movId },
      data: {
        gateOutAt: new Date(),
        gateOutBy: operatorId,
        truckPlate: dto.truckPlate ?? undefined,
        driverName: dto.driverName ?? undefined,
        driverPhone: dto.driverPhone ?? undefined,
        notes: dto.notes ?? undefined,
      },
      include: { exitLines: { include: { shipmentLine: true } } },
    });
  }

  async cancelExitMovement(movId: string, tenantId: string) {
    const mov = await this.prisma.exitMovement.findFirst({
      where: { id: movId, tenantId },
      include: { exitLines: true },
    });
    if (!mov) throw new NotFoundException('Bon de sortie introuvable.');
    if (mov.status !== 'DRAFT')
      throw new BadRequestException(
        'Seul un bon en brouillon peut être annulé.',
      );

    await this.prisma.$transaction(async (tx) => {
      // Rollback quantityOut sur chaque ligne concernée
      for (const el of mov.exitLines) {
        const line = await tx.shipmentLine.findUnique({
          where: { id: el.shipmentLineId },
          select: { quantityOut: true, quantity: true },
        });
        if (!line) continue;
        const newQtyOut = Math.max(0, line.quantityOut - el.quantityOut);
        const newStatus: ShipmentLineStatus =
          newQtyOut === 0
            ? ShipmentLineStatus.IN_STOCK
            : newQtyOut < line.quantity
              ? ShipmentLineStatus.PARTIAL_OUT
              : ShipmentLineStatus.OUT;
        await tx.shipmentLine.update({
          where: { id: el.shipmentLineId },
          data: { quantityOut: newQtyOut, status: newStatus },
        });
      }
      await tx.exitMovement.delete({ where: { id: movId } });
    });

    await this.recalcFileStatus(mov.shipmentFileId);
    return { cancelled: true };
  }

  async listAllExitMovements(
    tenantId: string,
    params: {
      status?: string;
      search?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const { status, search, skip = 0, take = 100 } = params;
    const where = {
      tenantId,
      ...(status ? { status: status as ExitMovementStatus } : {}),
      ...(search
        ? {
            OR: [
              {
                deliveryOrderRef: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                exitVoyageCode: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                truckPlate: { contains: search, mode: 'insensitive' as const },
              },
              {
                exitTransportDoc: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.exitMovement.count({ where }),
      this.prisma.exitMovement.findMany({
        where,
        include: {
          shipmentFile: {
            select: {
              id: true,
              voyageCode: true,
              clientRef: true,
              client: { select: { id: true, name: true } },
            },
          },
          exitShipmentType: { select: { label: true, icon: true } },
          exitLines: {
            select: {
              id: true,
              quantityOut: true,
              note: true,
              shipmentLine: {
                select: {
                  id: true,
                  packageRef: true,
                  packageTypeCode: true,
                  packageType: { select: { label: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return { total, items };
  }

  async listExitMovements(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    return this.prisma.exitMovement.findMany({
      where: { shipmentFileId: fileId },
      include: { exitLines: { include: { shipmentLine: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Suppression d'un dossier — Prisma cascade déjà ShipmentLine/Operation/
  // OperationLine/Invoice/… (onDelete: Cascade déclaré sur leur FK vers
  // ShipmentFile, voir schema.prisma), MAIS PAS YardContainer : un conteneur
  // est une ressource yard indépendante, potentiellement référencée par
  // PLUSIEURS dossiers (dépotage partiel en plusieurs lots — voir commentaire
  // sur ShipmentFile.yardContainerId) — Prisma ne peut donc pas décider seul
  // s'il doit disparaître avec ce dossier précis.
  //
  // Règle retenue : un conteneur PRODUIT par une opération de ce dossier
  // (OperationLine.yardContainerId, ex. ICD_FULL/ICD_EMPTY) est supprimé
  // avec le dossier SI ET SEULEMENT SI aucun autre dossier ni aucune autre
  // OperationLine (d'un autre dossier) ne le référence encore — sa position
  // yard est alors libérée (isOccupied=false), sinon elle resterait bloquée
  // indéfiniment. Le conteneur D'ORIGINE d'un dépotage (ShipmentFile.
  // yardContainerId — le conteneur préexistant qu'on est en train de vider)
  // n'est JAMAIS supprimé ici : il n'est pas produit par ce dossier, il lui
  // préexiste et peut être réutilisé par d'autres dossiers de dépotage.
  async deleteFile(id: string, tenantId: string) {
    await this.assertFile(id, tenantId);

    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: {
        yardContainerId: true,
        lines: { select: { id: true } },
        operations: {
          select: {
            lines: { select: { yardContainerId: true } },
          },
        },
        documents: { select: { blobName: true } },
      },
    });

    const producedContainerIds = [
      ...new Set(
        file!.operations
          .flatMap((o) => o.lines)
          .map((l) => l.yardContainerId)
          .filter(
            (cid): cid is string => !!cid && cid !== file!.yardContainerId,
          ),
      ),
    ];

    const deletableContainerIds: string[] = [];
    for (const containerId of producedContainerIds) {
      const [otherFile, otherLine] = await Promise.all([
        this.prisma.shipmentFile.findFirst({
          where: { yardContainerId: containerId, id: { not: id } },
          select: { id: true },
        }),
        this.prisma.operationLine.findFirst({
          where: {
            yardContainerId: containerId,
            operation: { shipmentFileId: { not: id } },
          },
          select: { id: true },
        }),
      ]);
      if (!otherFile && !otherLine) deletableContainerIds.push(containerId);
    }

    const eirReferenceIds = [
      ...file!.lines.map((l) => l.id),
      ...deletableContainerIds,
    ];
    const inspectionBlobs = eirReferenceIds.length
      ? (
          await this.prisma.eIR.findMany({
            where: { tenantId, referenceId: { in: eirReferenceIds } },
            select: { photos: true },
          })
        ).flatMap((eir) => eir.photos)
      : [];

    // Capturé AVANT suppression (la position elle-même n'est jamais
    // supprimée, seulement libérée — voir plus bas) pour notifier le plan du
    // yard après le commit avec les coordonnées complètes.
    const freedPositions = deletableContainerIds.length
      ? await this.prisma.yardPosition.findMany({
          where: {
            containers: { some: { id: { in: deletableContainerIds } } },
          },
          select: {
            yardId: true,
            block: true,
            bay: true,
            row: true,
            tier: true,
          },
        })
      : [];

    await this.prisma.$transaction(async (tx) => {
      if (deletableContainerIds.length) {
        const positions = await tx.yardContainer.findMany({
          where: { id: { in: deletableContainerIds } },
          select: { yardPositionId: true },
        });
        await tx.yardContainer.deleteMany({
          where: { id: { in: deletableContainerIds } },
        });
        const positionIds = positions
          .map((c) => c.yardPositionId)
          .filter((pid): pid is string => !!pid);
        if (positionIds.length) {
          await tx.yardPosition.updateMany({
            where: { id: { in: positionIds } },
            data: { isOccupied: false },
          });
        }
      }
      if (eirReferenceIds.length) {
        await tx.eIR.deleteMany({
          where: { referenceId: { in: eirReferenceIds } },
        });
      }
      await tx.shipmentFile.delete({ where: { id } });
    });
    await Promise.allSettled(
      [
        ...file!.documents.map((document) => document.blobName),
        ...inspectionBlobs,
      ].map((blobName) => this.documentStorage.delete(blobName)),
    );

    for (const position of freedPositions) {
      this.ymsService.emitPositionFreed(tenantId, position);
    }

    return { deleted: true, containersDeleted: deletableContainerIds.length };
  }

  // ── Blocage comptable AU NIVEAU DOSSIER ─────────────────────────────────
  // Distinct du blocage client (ClientAccountingBlock) — réservé DEX/ADMIN/
  // SUPER_ADMIN, appliqué via le RolesGuard côté contrôleur. Miroir de
  // blockDossier()/unblockDossier() côté frontend (dos-store.js).

  async blockFile(
    id: string,
    tenantId: string,
    userId: string,
    dto: BlockFileDto,
  ) {
    await this.assertFile(id, tenantId);
    return this.prisma.shipmentFile.update({
      where: { id },
      data: {
        blockedReason: dto.reason || 'Factures impayées',
        blockedById: userId,
        blockedAt: new Date(),
      },
      select: FILE_SELECT,
    });
  }

  async unblockFile(id: string, tenantId: string) {
    await this.assertFile(id, tenantId);
    return this.prisma.shipmentFile.update({
      where: { id },
      data: { blockedReason: null, blockedById: null, blockedAt: null },
      select: FILE_SELECT,
    });
  }

  // ── Prorogation sommier ───────────────────────────────────────────────────

  async extendSommier(id: string, tenantId: string, operatorId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        voyageCode: true,
        clientRef: true,
        sommierExpiryDate: true,
        sommierOriginalDate: true,
        sommierExtensionsUsed: true,
        storageRegime: {
          select: {
            sommierDays: true,
            sommierExtensionDays: true,
            sommierMaxExtensions: true,
          },
        },
      },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    if (!file.sommierExpiryDate)
      throw new BadRequestException("Ce dossier n'a pas de sommier.");
    if (!file.storageRegime.sommierExtensionDays)
      throw new BadRequestException(
        'Le régime de ce dossier ne permet pas de prorogation.',
      );

    const maxExt = file.storageRegime.sommierMaxExtensions ?? 1;
    if (file.sommierExtensionsUsed >= maxExt)
      throw new BadRequestException(
        `Nombre maximum de prorogations atteint (${maxExt}).`,
      );

    // Nouvelle date = date expiry actuelle + jours d'extension
    const newExpiry = new Date(file.sommierExpiryDate);
    newExpiry.setDate(
      newExpiry.getDate() + file.storageRegime.sommierExtensionDays,
    );

    const updated = await this.prisma.shipmentFile.update({
      where: { id },
      data: {
        sommierOriginalDate: file.sommierOriginalDate ?? file.sommierExpiryDate,
        sommierExpiryDate: newExpiry,
        sommierExtendedAt: new Date(),
        sommierExtendedBy: operatorId,
        sommierExtensionsUsed: file.sommierExtensionsUsed + 1,
      },
      select: FILE_SELECT,
    });

    // Les jobs encore planifiés portent les anciennes échéances : on les
    // annule avant de recréer J-30/J-7/J0 sur la date prorogée.
    await this.alertsService.cancelSommierAlerts(id);

    // Re-schedule les alertes sur la nouvelle date
    void this.alertsService.scheduleSommierAlerts(
      id,
      newExpiry,
      tenantId,
      file.voyageCode,
      file.clientRef ?? null,
    );

    return updated;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async assertFile(id: string, tenantId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    return file;
  }

  private async recalcFileStatus(fileId: string) {
    const lines = await this.prisma.shipmentLine.findMany({
      where: { shipmentFileId: fileId },
      select: { status: true },
    });
    if (!lines.length) return;

    const total = lines.length;
    const outCount = lines.filter(
      (l) => l.status === ShipmentLineStatus.OUT,
    ).length;
    const partialCount = lines.filter(
      (l) => l.status === ShipmentLineStatus.PARTIAL_OUT,
    ).length;

    let newStatus: ShipmentFileStatus;
    if (outCount === total) newStatus = ShipmentFileStatus.FULLY_OUT;
    else if (outCount > 0 || partialCount > 0)
      newStatus = ShipmentFileStatus.PARTIAL_OUT;
    else newStatus = ShipmentFileStatus.IN_STOCK;

    const file = await this.prisma.shipmentFile.update({
      where: { id: fileId },
      data: { status: newStatus },
      select: { yardContainerId: true },
    });

    if (newStatus === ShipmentFileStatus.FULLY_OUT && file.yardContainerId) {
      await this.tryCloseDevanning(file.yardContainerId);
    }
  }

  // Lève isBeingDevanned et passe le conteneur à vide dès que plus aucun
  // dossier WMS lié n'est en attente de sortie (tous FULLY_OUT) — appelé
  // après le recalcul automatique de statut, en complément de l'action
  // manuelle "Fin de dépotage" côté YMS.
  private async tryCloseDevanning(yardContainerId: string) {
    const stillPending = await this.prisma.shipmentFile.findFirst({
      where: {
        yardContainerId,
        status: { not: ShipmentFileStatus.FULLY_OUT },
      },
      select: { id: true },
    });
    if (stillPending) return;

    await this.prisma.yardContainer.update({
      where: { id: yardContainerId },
      data: { isBeingDevanned: false, containerType: ContainerType.EMPTY },
    });
  }
}
