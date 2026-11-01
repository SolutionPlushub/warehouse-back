import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { sizeForType } from '../common/container-iso';
import { PrismaService } from '../prisma/prisma.service';
import {
  ShipmentLineStatus,
  HandlingCrewType,
  ContainerType,
  TruckLoadStatus,
  YardContainerStatus,
  OperationStatus,
  OperationType,
  OperationLineRole,
  ShipmentFileStatus,
  PaymentStatus,
  InvoiceStatus,
  SlotChangeStatus,
  UserRole,
  Prisma,
  FleetOwnership,
} from '@prisma/client';
import { CreateOperationDto } from './dto/create-operation.dto';
import { DecideOperationDto } from './dto/decide-operation.dto';
import { AdvanceOperationDto } from './dto/advance-operation.dto';
import { RewindOperationDto } from './dto/rewind-operation.dto';
import { CapacityReservationDto } from './dto/capacity-reservation.dto';
import { EntryAuthorizationDto } from './dto/entry-authorization.dto';
import { EmailEntryPassDto } from './dto/email-entry-pass.dto';
import { GateInPassDto } from './dto/gate-in-pass.dto';
import { UpdateGatePassDto } from './dto/update-gate-pass.dto';
import { InspectUnitDto } from './dto/inspect-unit.dto';
import {
  SlotChangeRequestDto,
  DecideSlotChangeDto,
} from './dto/slot-change-request.dto';
import { OPERATION_TYPE_CFG, stepKindOf } from './operation-types';
import {
  PICKUP_DETENTION_FREE_HOURS,
  PICKUP_WAIT_ALERT_HOURS,
  PICKUP_WAIT_WARN_HOURS,
  pickupDetentionDays,
  pickupWaitBand,
  pickupWaitHours,
} from './pickup-wait.constants';
import { InvoicesService } from '../invoices/invoices.service';
import { InducedServicesService } from '../induced-services/induced-services.service';
import { YardMapGateway } from '../yard-map/yard-map.gateway';
import { MailService } from '../mail/mail.service';
import { TmsService } from '../tms/tms.service';
import { GateRegistryService } from '../tms/gate-registry.service';
import { AlertsService } from '../alerts/alerts.service';
import { AccessControlService } from '../access-control/access-control.service';
import {
  countStayDays,
  stayBillableDays,
} from '../stay-engine/stay-engine';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Colonnes d'OperationLine écrasées par chaque nature d'étape (advance()) —
// sauvegardées dans OperationStepLog.data puis restaurées par rewind().
const STEP_SNAPSHOT_FIELDS: Record<string, string[]> = {
  placement: ['slot'],
  slot: ['slot'],
  whreception: ['slot'],
  tally: ['quantity'],
  unload: ['quantity'],
  picking: ['quantity'],
  load: ['quantity'],
  quality: ['qualityResult', 'qualityNc', 'qualityCheckedAt'],
  doc: ['docNumber', 'docSentTo', 'docIssuedAt'],
  report: [
    'reportNumber',
    'reportReceived',
    'reportSignDmt',
    'reportSignThird',
    'reportIssuedAt',
  ],
  seal: ['sealRead', 'sealState', 'sealWitness', 'sealCheckedAt'],
  gateout: [
    'gateOutDriver',
    'gateOutDestination',
    'gateOutAt',
    'pickupTruckPlate',
    'pickupTruckCarrier',
    'pickupDriverName',
    'pickupDriverCin',
    'pickupPermitNo',
  ],
  grounding: ['groundedAt'],
  loadplan: [
    'truckPlate',
    'truckCarrier',
    'truckAssignedAt',
    'pickupTruckPlate',
    'pickupTruckCarrier',
    'pickupDriverName',
    'pickupDriverCin',
    'pickupPermitNo',
    'pickupLoadedAt',
  ],
  resources: ['equipmentName', 'handlingCrewType', 'handlingCrewCount'],
};
const SNAPSHOT_DATE_FIELDS = new Set([
  'qualityCheckedAt',
  'docIssuedAt',
  'reportIssuedAt',
  'sealCheckedAt',
  'gateOutAt',
  'groundedAt',
  'truckAssignedAt',
  'pickupLoadedAt',
]);
// Étapes dont l'effet ne se défait pas par un simple retour arrière.
const NON_REWINDABLE_KINDS: Record<string, string> = {
  reserve:
    "la réservation a créé le conteneur vide — supprimez-le depuis le parc conteneurs avant de refaire l'étape",
  emptyreturn: 'le conteneur vide est déjà sorti du site',
  billing: 'la facturation a déjà été émise',
};
// Rôles habilités à approuver/décider sans passer par la file d'attente —
// miroir de isDexUser() côté frontend (dos-config-store.js).
const DEX_ROLES: UserRole[] = [
  UserRole.DEX,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

// Ordre réel des 15 codes standard (OperationStatus, schema.prisma) —
// reserveCapacity()/authorizeEntry()/gateIn() font avancer Operation.status
// jusqu'à l'étape correspondante via advanceOperationStatus() ci-dessous, EN
// PLUS de l'état déjà tracé ailleurs (OperationLine.slot, bonNumber,
// GatePass[]) qui reste la source de vérité fonctionnelle pour ces
// endpoints — ce champ ne fait que refléter au mieux la progression pour les
// écrans/rapports qui s'y fient, jamais consulté en interne par ces mêmes
// méthodes pour décider quoi que ce soit.
const OPERATION_STATUS_ORDER: OperationStatus[] = [
  OperationStatus.DRAFT,
  OperationStatus.PRE_ALERTE,
  OperationStatus.TO_VALIDATE,
  OperationStatus.REJECTED,
  OperationStatus.DOSSIER_CREE,
  OperationStatus.CAPACITE_VALIDEE,
  OperationStatus.AUTORISE_ENTREE,
  OperationStatus.GATE_IN,
  OperationStatus.DOCUMENTS_VALIDES,
  OperationStatus.EN_OPERATION,
  OperationStatus.EN_STOCK,
  OperationStatus.ORDRE_SORTIE,
  OperationStatus.VALIDATION_FINANCE,
  OperationStatus.VALIDATION_DEX,
  OperationStatus.LIBERE_SORTIE,
  OperationStatus.GATE_OUT,
  OperationStatus.SORTI,
  OperationStatus.DOSSIER_CLOS,
];

/** Surface entrepôt portée par OperationLine.slot, une fois par opération. */
function warehouseSlotSurface(
  lines: { operationId?: string; slot: unknown }[],
  zoneId: string,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const line of lines) {
    const key = line.operationId ?? '';
    if (key && seen.has(key)) continue;
    const slot = line.slot as { zoneId?: string; surfaceM2?: number } | null;
    if (
      !slot ||
      slot.zoneId !== zoneId ||
      !(slot.surfaceM2 && slot.surfaceM2 > 0)
    )
      continue;
    if (key) seen.add(key);
    total += slot.surfaceM2;
  }
  return total;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly inducedServicesService: InducedServicesService,
    private readonly yardMapGateway: YardMapGateway,
    private readonly mailService: MailService,
    private readonly tmsService: TmsService,
    private readonly alertsService: AlertsService,
    private readonly access: AccessControlService,
    private readonly gateRegistry: GateRegistryService,
  ) {}

  private async countTenantStayDays(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stayWeekendsIncluded: true },
    });
    return countStayDays(start, end, tenant?.stayWeekendsIncluded ?? true);
  }

  private async assertFile(fileId: string, tenantId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { id: true, clientId: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    return file;
  }

  // Refuse toute nouvelle opération si le client du dossier est bloqué par
  // la comptabilité — miroir de lock() côté frontend (dos-store.js).
  private async assertClientNotBlocked(
    tenantId: string,
    clientId: string | null,
  ) {
    if (!clientId) return;
    const blocked = await this.prisma.clientAccountingBlock.findUnique({
      where: { tenantId_clientId: { tenantId, clientId } },
    });
    if (blocked)
      throw new BadRequestException(
        `Client bloqué par la comptabilité (${blocked.reason}) — aucune nouvelle opération ne peut être créée. Contactez le DEX pour régularisation.`,
      );
  }

  // Vérifie que le dossier a bien un item dans un statut compatible avec le
  // prérequis d'input du type d'opération demandé — miroir de
  // getAvailableOperationTypes() côté frontend (lib/data/operations.js).
  private async assertInputSatisfied(
    fileId: string,
    tenantId: string,
    requiresInput: string | null,
  ) {
    if (!requiresInput) return;

    if (requiresInput === 'lines_in_stock') {
      const line = await this.prisma.shipmentLine.findFirst({
        where: { shipmentFileId: fileId, status: ShipmentLineStatus.IN_STOCK },
        select: { id: true },
      });
      if (!line)
        throw new BadRequestException(
          "Ce dossier n'a aucune ligne en stock (IN_STOCK) — prérequis non satisfait pour ce type d'opération.",
        );
      return;
    }

    if (requiresInput === 'container_in_yard') {
      // Filiation réelle conteneur↔dossier : PAS ShipmentFile.yardContainerId
      // (sert un autre cas d'usage — dossier ouvert DEPUIS un conteneur YMS
      // déjà existant) ni YardContainer.shipmentFiles (relation implicite
      // jamais peuplée nulle part dans le code) — le seul lien réel est
      // OperationLine.yardContainerId sur une Operation de CE dossier.
      const opLine = await this.prisma.operationLine.findFirst({
        where: {
          operation: { shipmentFileId: fileId, tenantId },
          yardContainer: { status: YardContainerStatus.IN_YARD },
        },
        select: { id: true },
      });
      if (!opLine)
        throw new BadRequestException(
          "Ce dossier n'a aucun conteneur en yard (IN_YARD) — prérequis non satisfait pour ce type d'opération.",
        );
    }
  }

  async findByFile(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    return this.prisma.operation.findMany({
      where: { shipmentFileId: fileId },
      orderBy: { createdAt: 'asc' },
      include: { lines: true },
    });
  }

  // Suppression d'une opération ajoutée par erreur (doublon…) — jamais
  // l'opération initiale du dossier, et seulement si aucune unité n'a
  // franchi d'étape (aucun effet terrain à défaire).
  /**
   * Dossier terminé : toutes ses opérations sont sorties (ou closes) → le
   * dossier passe FULLY_OUT (« Sorti »). Appelé après chaque fin
   * d'opération et à la sortie d'un conteneur par le Gate OUT du parc.
   */
  async syncFileCompletion(fileId: string) {
    const ops = await this.prisma.operation.findMany({
      where: { shipmentFileId: fileId },
      select: { status: true },
    });
    if (!ops.length) return;
    const finished = ops.every(
      (o) =>
        o.status === OperationStatus.SORTI ||
        o.status === OperationStatus.DOSSIER_CLOS,
    );
    if (finished)
      await this.prisma.shipmentFile.update({
        where: { id: fileId },
        data: { status: ShipmentFileStatus.FULLY_OUT },
      });
  }

  /**
   * Transbordement — ce qui empêche encore la clôture du dossier : porteurs
   * (conteneurs) et camions récepteurs encore sur le parc.
   */
  async transshipBlockers(fileId: string, tenantId: string) {
    const [containers, loads, receivers] = await Promise.all([
      this.prisma.yardContainer.findMany({
        where: {
          tenantId,
          status: { not: YardContainerStatus.DEPARTED },
          operationLines: {
            some: {
              operation: { shipmentFileId: fileId, type: OperationType.DEP_TRANS },
            },
          },
        },
        select: { containerNumber: true },
      }),
      this.prisma.truckLoad.findMany({
        where: {
          tenantId,
          status: TruckLoadStatus.LOADED,
          lines: { some: { shipmentFileId: fileId } },
        },
        select: { plate: true },
      }),
      this.prisma.gateTruckVisit.findMany({
        where: {
          tenantId,
          shipmentFileId: fileId,
          purpose: 'RECEIVER',
          status: 'ON_SITE',
        },
        select: { plate: true },
      }),
    ]);
    const blockers: string[] = [];
    if (containers.length)
      blockers.push(
        `porteur(s) encore sur le parc : ${containers.map((c) => c.containerNumber).join(', ')}`,
      );
    const plates = [...new Set([...loads, ...receivers].map((t) => t.plate))];
    if (plates.length)
      blockers.push(`camion(s) récepteur(s) sur le parc : ${plates.join(', ')}`);
    return blockers;
  }

  /**
   * « Retour conteneur vide » déjà réalisé (porteur sorti après dépotage) :
   * l'étape est validée d'office, à la date réelle de sortie du conteneur.
   */
  async completeEmptyReturns(
    operationId: string,
    lineIds: string[],
    userId: string,
  ) {
    const cfg = OPERATION_TYPE_CFG[OperationType.DEP_TRANS];
    const idx = cfg.steps.indexOf('Retour conteneur vide');
    if (idx < 0) return 0;
    const lines = await this.prisma.operationLine.findMany({
      where: {
        operationId,
        id: { in: lineIds },
        done: false,
        stepIdx: idx,
        yardContainer: { status: YardContainerStatus.DEPARTED },
      },
      select: { id: true, yardContainer: { select: { gateOutDate: true } } },
    });
    if (!lines.length) return 0;
    const isLast = idx === cfg.steps.length - 1;
    await this.prisma.$transaction([
      this.prisma.operationLine.updateMany({
        where: { id: { in: lines.map((l) => l.id) } },
        data: { stepIdx: idx + 1, done: isLast },
      }),
      this.prisma.operationStepLog.createMany({
        data: lines.map((l) => ({
          operationLineId: l.id,
          stepIdx: idx,
          stepLabel: cfg.steps[idx],
          kind: 'emptyreturn',
          byId: userId,
          performedAt: l.yardContainer?.gateOutDate ?? new Date(),
          data: { line: {}, auto: 'carrierExit' } as Prisma.InputJsonValue,
        })),
      }),
    ]);
    return lines.length;
  }

  /** Clôt l'opération (et le dossier) quand toutes ses unités sont terminées. */
  async finishIfDone(operationId: string) {
    const op = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { type: true, status: true, shipmentFileId: true },
    });
    if (!op || op.status === OperationStatus.DOSSIER_CLOS) return;
    const remaining = await this.prisma.operationLine.count({
      where: { operationId, done: false },
    });
    if (remaining) return;
    const allGone =
      OPERATION_TYPE_CFG[op.type].dir === 'OUT' ||
      op.type === OperationType.DEP_TRANS;
    await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: allGone ? OperationStatus.SORTI : OperationStatus.EN_STOCK,
      },
    });
    await this.syncFileCompletion(op.shipmentFileId);
  }

  /**
   * Sortie du camion chargé : les unités à l'étape « Sortie camion » dont
   * TOUS les camions chargés ont quitté le parc franchissent l'étape à la
   * date réelle du dernier gate out (arrêt du compteur, facture si c'était
   * le dernier camion du dossier). Sans effet sinon — jamais bloquant.
   */
  async autoTruckExit(
    operationId: string,
    lineIds: string[],
    tenantId: string,
    userId: string,
    userRole: UserRole,
  ) {
    const cfg = OPERATION_TYPE_CFG[OperationType.DEP_TRANS];
    const idx = cfg.steps.indexOf('Sortie camion');
    const lines = await this.prisma.operationLine.findMany({
      where: {
        operationId,
        id: { in: lineIds },
        done: false,
        stepIdx: idx,
        operation: { tenantId, type: OperationType.DEP_TRANS },
      },
      select: {
        id: true,
        truckLoadLines: {
          where: { truckLoad: { status: { not: TruckLoadStatus.CANCELLED } } },
          select: {
            truckLoad: {
              select: {
                status: true,
                gateOutAt: true,
                plate: true,
                carrier: true,
                driverName: true,
                driverCin: true,
                permitNo: true,
                destination: true,
              },
            },
          },
        },
      },
    });
    const ready = lines.filter(
      (l) =>
        l.truckLoadLines.length > 0 &&
        l.truckLoadLines.every(
          (x) =>
            x.truckLoad.status !== TruckLoadStatus.LOADED &&
            !!x.truckLoad.gateOutAt,
        ),
    );
    if (!ready.length) return 0;
    const trucks = ready.flatMap((l) => l.truckLoadLines.map((x) => x.truckLoad));
    const last = trucks.reduce((a, b) =>
      (b.gateOutAt?.getTime() ?? 0) > (a.gateOutAt?.getTime() ?? 0) ? b : a,
    );
    try {
      await this.advance(operationId, tenantId, userId, userRole, {
        operationLineIds: ready.map((l) => l.id),
        kind: 'gateout',
        expectedStepIdx: idx,
        performedAt: last.gateOutAt!.toISOString(),
        data: {
          gateOut: {
            driver: last.driverName ?? '',
            plate: last.plate,
            carrier: last.carrier ?? undefined,
            cin: last.driverCin ?? undefined,
            permit: last.permitNo ?? undefined,
            destination: last.destination ?? undefined,
          },
        },
      } as AdvanceOperationDto);
      return ready.length;
    } catch {
      return 0;
    }
  }

  async removeOperation(fileId: string, operationId: string, tenantId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, shipmentFileId: fileId, tenantId },
      select: {
        id: true,
        type: true,
        bonNumber: true,
        lines: { select: { stepIdx: true, done: true } },
        _count: { select: { gatePasses: true } },
      },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    const first = await this.prisma.operation.findFirst({
      where: { shipmentFileId: fileId, tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (first?.id === operationId)
      throw new BadRequestException(
        "L'opération initiale du dossier ne peut pas être supprimée.",
      );
    if (
      op.bonNumber ||
      op._count.gatePasses > 0 ||
      op.lines.some((l) => l.done || l.stepIdx > 0)
    )
      throw new BadRequestException(
        'Cette opération a déjà été exécutée (étape franchie, Bon à Entrer ou passage Gate) — revenez d\'abord aux étapes précédentes.',
      );
    await this.prisma.operation.delete({ where: { id: operationId } });
    await this.inducedServicesService
      .resolve(fileId, tenantId, {})
      .catch(() => undefined);
    return { ok: true };
  }

  async create(fileId: string, tenantId: string, dto: CreateOperationDto) {
    const file = await this.assertFile(fileId, tenantId);
    await this.assertClientNotBlocked(tenantId, file.clientId);

    const cfg = OPERATION_TYPE_CFG[dto.type];
    await this.assertInputSatisfied(fileId, tenantId, cfg.requiresInput);

    if (dto.type === OperationType.ENT_IN) {
      const depStock = await this.prisma.operation.count({
        where: { shipmentFileId: fileId, tenantId, type: OperationType.DEP_STOCK },
      });
      if (depStock)
        throw new BadRequestException(
          'Inutile : le dépotage avec stockage met déjà la marchandise en entrepôt — la sortie est créée automatiquement après le placement.',
        );
    }

    // Pas de doublon : une opération du même type encore en cours sur ce
    // dossier (double-clic → 6 « Sortie conteneurs » identiques sur FIT2602).
    const sameOpen = await this.prisma.operation.findFirst({
      where: {
        shipmentFileId: fileId,
        tenantId,
        type: dto.type,
        status: {
          notIn: [
            OperationStatus.SORTI,
            OperationStatus.DOSSIER_CLOS,
            OperationStatus.REJECTED,
          ],
        },
        OR: [{ lines: { some: { done: false } } }, { lines: { none: {} } }],
      },
      select: { id: true },
    });
    if (sameOpen)
      throw new BadRequestException(
        `Une opération « ${dto.type} » est déjà en cours sur ce dossier — exécutez-la ou supprimez-la avant d'en ajouter une autre.`,
      );

    // Rattache immédiatement les inputs déjà identifiables du dossier à cette
    // opération (OperationLine[INPUT]) — sans ça, l.stepIdx/.done (suivi par
    // unité, voir dos-store.js unitOp()) n'aurait rien à faire progresser
    // pour une opération ajoutée après coup (ex: EMP_EXPORT sur un dossier
    // qui a déjà du stock). Le conteneur vide réservé pour EMP_EXPORT
    // (OUTPUT, pas encore connu à cette étape) est créé séparément à l'étape
    // "Réservation / Réception conteneur vide" du pipeline.
    const operation = await this.prisma.$transaction(async (tx) => {
      const operation = await tx.operation.create({
        data: {
          shipmentFileId: fileId,
          tenantId,
          type: dto.type,
          status: cfg.initialStatus,
        },
      });

      if (cfg.requiresInput === 'lines_in_stock') {
        const lines = await tx.shipmentLine.findMany({
          where: {
            shipmentFileId: fileId,
            status: ShipmentLineStatus.IN_STOCK,
          },
          select: { id: true },
        });
        if (lines.length) {
          await tx.operationLine.createMany({
            data: lines.map((l) => ({
              operationId: operation.id,
              shipmentLineId: l.id,
              role: OperationLineRole.INPUT,
            })),
          });
        }
      } else if (cfg.requiresInput === 'container_in_yard') {
        // Filiation réelle : OperationLine.yardContainerId sur une opération
        // EXISTANTE de ce dossier (voir assertInputSatisfied ci-dessus) —
        // pas YardContainer.shipmentFiles (relation implicite jamais peuplée).
        const existingOpLines = await tx.operationLine.findMany({
          where: {
            operation: { shipmentFileId: fileId, tenantId },
            yardContainer: {
              status: YardContainerStatus.IN_YARD,
              // Conteneur déjà engagé dans une sortie en cours : exclu.
              operationLines: {
                none: {
                  done: false,
                  operation: {
                    type: { in: [OperationType.ICD_OUT] },
                    status: { notIn: [OperationStatus.SORTI, OperationStatus.DOSSIER_CLOS] },
                  },
                },
              },
            },
          },
          select: { yardContainerId: true },
          distinct: ['yardContainerId'],
        });
        const containerIds = existingOpLines
          .map((l) => l.yardContainerId)
          .filter((id): id is string => !!id);
        if (containerIds.length) {
          await tx.operationLine.createMany({
            data: containerIds.map((id) => ({
              operationId: operation.id,
              yardContainerId: id,
              role: OperationLineRole.INPUT,
            })),
          });
        }
      }

      return operation;
    });

    // Régénère les lignes obligatoires/conditionnelles pour englober ce
    // nouveau type d'opération (resolve() recalcule TOUJOURS l'ensemble des
    // opérations du dossier, pas seulement la nouvelle — voir sa
    // documentation). `days` doit refléter un séjour RÉEL déjà en cours
    // s'il y en a un, sinon la ligne de séjour existante serait écrasée à
    // quantité nulle ; à défaut de séjour démarré, 0 (seules les prestations
    // mandatory=true, indépendantes des jours, sont alors ajoutées — voir
    // décision explicite, moteur de séjour).
    const ongoingStorage = await this.prisma.operation.findFirst({
      where: {
        shipmentFileId: fileId,
        tenantId,
        storageBillingStartedAt: { not: null },
        storageBillingEndedAt: null,
      },
      select: { storageBillingStartedAt: true, storageFreetimeDays: true },
      orderBy: { storageBillingStartedAt: 'asc' },
    });
    const days = ongoingStorage?.storageBillingStartedAt
      ? await this.countTenantStayDays(
          tenantId,
          ongoingStorage.storageBillingStartedAt,
          new Date(),
        )
      : 0;
    const freetime = ongoingStorage?.storageFreetimeDays ?? 0;
    await this.inducedServicesService.resolve(fileId, tenantId, {
      days,
      freetime,
    });

    return operation;
  }

  async close(operationId: string, tenantId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      select: { id: true, type: true, shipmentFileId: true },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    // Conteneurs encore sur le parc : clôturer ne les sort pas — c'est ce
    // qui laissait 97 vides HMM2610 « en yard » après leur départ réel.
    const stillIn = await this.prisma.yardContainer.findMany({
      where: {
        tenantId,
        status: { in: [YardContainerStatus.IN_YARD, YardContainerStatus.ON_HOLD] },
        operationLines: { some: { operationId } },
      },
      select: { containerNumber: true },
    });
    if (stillIn.length)
      throw new BadRequestException(
        `Clôture impossible : ${stillIn.length} conteneur(s) encore sur le parc (${stillIn
          .slice(0, 5)
          .map((c) => c.containerNumber)
          .join(', ')}${stillIn.length > 5 ? '…' : ''}) — enregistrez d'abord leur Gate OUT.`,
      );
    // Transbordement : clôture seulement quand plus aucun camion du dossier
    // (porteur ou camion chargé) n'est sur le parc.
    if (op.type === OperationType.DEP_TRANS) {
      const blockers = await this.transshipBlockers(op.shipmentFileId, tenantId);
      if (blockers.length)
        throw new BadRequestException(
          `Clôture impossible : ${blockers.join(' ; ')}.`,
        );
    }

    return this.prisma.operation.update({
      where: { id: operationId },
      data: { status: 'DOSSIER_CLOS', closedAt: new Date() },
    });
  }

  // ── Validation hiérarchique N+1 ─────────────────────────────────────────
  // Cycle : DRAFT → (submit) → TO_VALIDATE → (validate) → DOSSIER_CREE
  //                                        → (reject)   → REJECTED → (reopen) → DRAFT
  // S'applique à l'Operation initiale du dossier (la plus ancienne) — miroir
  // de `d.validation`/`d.status` côté frontend (dos-store.js), où le cycle
  // N+1 est porté au niveau du dossier plutôt que d'une opération quelconque.
  // ShipmentFile.status reste dérivé (règle 3 du claude.md) : basculé sur
  // BLOCKED tant que l'opération initiale n'est pas validée, puis rendu à
  // la logique WMS normale une fois validée.

  private async assertInitialOperation(fileId: string, tenantId: string) {
    await this.assertFile(fileId, tenantId);
    const op = await this.prisma.operation.findFirst({
      where: { shipmentFileId: fileId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!op) throw new NotFoundException("Ce dossier n'a aucune opération.");
    return op;
  }

  async submit(
    fileId: string,
    tenantId: string,
    userId: string,
    operationId?: string,
  ) {
    // Par défaut, cible l'opération initiale du dossier (rétrocompatible —
    // c'est le cas d'usage historique : soumission N+1 à la création). Un
    // operationId explicite permet de soumettre une opération ajoutée
    // ultérieurement à un dossier existant (CLAUDE.md : les 15 codes
    // standard s'appliquent PAR OPÉRATION, pas seulement à la première).
    const op = operationId
      ? await this.prisma.operation.findFirst({
          where: { id: operationId, shipmentFileId: fileId, tenantId },
        })
      : await this.assertInitialOperation(fileId, tenantId);
    if (!op) throw new NotFoundException('Opération introuvable.');
    if (op.status !== OperationStatus.DRAFT)
      throw new BadRequestException(
        `Impossible de soumettre : l'opération est au statut ${op.status}, attendu DRAFT.`,
      );

    const [, file] = await this.prisma.$transaction([
      this.prisma.operation.update({
        where: { id: op.id },
        data: {
          status: OperationStatus.TO_VALIDATE,
          submittedAt: new Date(),
          submittedById: userId,
        },
      }),
      this.prisma.shipmentFile.update({
        where: { id: fileId },
        data: { status: ShipmentFileStatus.BLOCKED },
      }),
    ]);
    return file;
  }

  async validate(
    operationId: string,
    tenantId: string,
    userId: string,
    dto: DecideOperationDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    if (op.status !== OperationStatus.TO_VALIDATE)
      throw new BadRequestException(
        `Impossible de valider : l'opération est au statut ${op.status}, attendu TO_VALIDATE.`,
      );

    const [operation] = await this.prisma.$transaction([
      this.prisma.operation.update({
        where: { id: operationId },
        data: {
          status: OperationStatus.DOSSIER_CREE,
          decidedAt: new Date(),
          decidedById: userId,
          decisionComment: dto.comment,
        },
      }),
      // Dossier débloqué — la mécanique WMS normale (réception, mise en
      // stock…) reprend la main sur ShipmentFile.status dès la prochaine
      // opération physique.
      this.prisma.shipmentFile.update({
        where: { id: op.shipmentFileId },
        data: { status: ShipmentFileStatus.DRAFT },
      }),
    ]);
    return operation;
  }

  async reject(
    operationId: string,
    tenantId: string,
    userId: string,
    dto: DecideOperationDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    if (op.status !== OperationStatus.TO_VALIDATE)
      throw new BadRequestException(
        `Impossible de rejeter : l'opération est au statut ${op.status}, attendu TO_VALIDATE.`,
      );

    return this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: OperationStatus.REJECTED,
        decidedAt: new Date(),
        decidedById: userId,
        decisionComment: dto.comment,
      },
    });
  }

  async reopen(operationId: string, tenantId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    if (op.status !== OperationStatus.REJECTED)
      throw new BadRequestException(
        `Impossible de rouvrir : l'opération est au statut ${op.status}, attendu REJECTED.`,
      );

    return this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: OperationStatus.DRAFT,
        submittedAt: null,
        submittedById: null,
        decidedAt: null,
        decidedById: null,
        decisionComment: null,
      },
    });
  }

  // ── Avancement par unité à travers le pipeline d'étapes ─────────────────
  // Miroir du noyau de executeOpStep() côté frontend (dos-store.js) :
  // avance un lot d'OperationLine d'une étape, à condition qu'elles soient
  // toutes au même stepIdx. Applique le gating §15 (Finance→DEX) avant la
  // dernière étape d'une opération sortante. Les effets de bord métier
  // spécifiques (placement d'emplacement, facturation, rattachement camion)
  // restent hors périmètre — voir les chantiers dédiés.

  // ── Réservation de capacité (ICD yard ou entrepôt) ──────────────────────
  // Miroir de reserveCapacity(id, alloc) côté frontend (dos-store.js).
  // Persiste directement sur OperationLine.slot — distinct du flux
  // d'approbation SlotChangeApproval, réservé aux changements ultérieurs
  // d'une unité déjà placée (voir requestSlotChange()/advance(kind=placement)).

  async reserveCapacity(
    operationId: string,
    tenantId: string,
    dto: CapacityReservationDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      include: {
        lines: true,
        shipmentFile: { select: { defaultYardId: true } },
      },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');

    if (dto.mode === 'icd') {
      const slots = dto.slots ?? [];
      if (!slots.length)
        throw new BadRequestException(
          'Au moins un emplacement ICD doit être fourni (mode=icd).',
        );

      const lineIds = new Set(op.lines.map((l) => l.id));
      for (const s of slots) {
        if (!lineIds.has(s.operationLineId))
          throw new BadRequestException(
            `La ligne ${s.operationLineId} n'appartient pas à cette opération.`,
          );
      }

      const yardId = op.shipmentFile.defaultYardId;
      if (!yardId)
        throw new BadRequestException(
          'Aucun yard par défaut sur ce dossier — impossible de valider les emplacements ICD.',
        );

      // Vérifie que chaque emplacement demandé existe et est libre (ou déjà
      // occupé par la même ligne, dans le cas d'une revalidation).
      const positions: Array<{
        id: string;
        block: string;
        bay: number;
        row: number;
        tier: number;
      }> = [];
      // Une seule requête pour tout le lot (une par conteneur faisait
      // expirer la réservation au-delà d'une cinquantaine de conteneurs).
      const allPositions = await this.prisma.yardPosition.findMany({
        where: {
          yardId,
          OR: slots.map((s) => ({
            block: s.block,
            bay: s.bay,
            row: s.row,
            tier: s.tier,
          })),
        },
      });
      const posKey = (p: { block: string; bay: number; row: number; tier: number }) =>
        `${p.block}|${p.bay}|${p.row}|${p.tier}`;
      const positionByKey = new Map(allPositions.map((p) => [posKey(p), p]));
      for (const s of slots) {
        const pos = positionByKey.get(posKey(s));
        if (!pos)
          throw new BadRequestException(
            `Emplacement ${s.block}-B${s.bay}-R${s.row}-T${s.tier} introuvable dans le yard.`,
          );
        if (pos.isOccupied)
          throw new BadRequestException(
            `Emplacement ${s.block}-B${s.bay}-R${s.row}-T${s.tier} déjà occupé.`,
          );
        positions.push(pos);
      }

      // Rattache la position au VRAI conteneur quand la ligne en porte un —
      // sans ça, YardContainer.yardPositionId reste inchangé (invisible sur
      // le plan du yard/Parc conteneurs), et seul OperationLine.slot est
      // renseigné, un champ parallèle qui ne pilote aucun écran YMS.
      //
      // Statut POSITIONING (pas IN_YARD) : la réservation de capacité fixe
      // l'emplacement CIBLE, mais ne confirme pas la présence physique du
      // conteneur — c'est le Gate In (voir gateIn() ci-dessous) qui doit
      // faire cette confirmation en dernier, une fois le camion réellement
      // arrivé. L'autorisation d'entrée (authorizeEntry()) n'a jamais eu à
      // toucher ce statut non plus, seul gateIn() le fait passer à IN_YARD.
      const lineById = new Map(op.lines.map((l) => [l.id, l]));
      const containerUpdates = slots
        .map((s, i) => ({
          s,
          pos: positions[i],
          line: lineById.get(s.operationLineId),
        }))
        .filter(
          (x): x is typeof x & { line: NonNullable<typeof x.line> } =>
            !!x.line?.yardContainerId,
        );

      // Transaction interactive au délai étendu (lots de 50+ conteneurs) ;
      // positions marquées occupées en une seule requête.
      await this.prisma.$transaction(
        async (tx) => {
          for (const s of slots)
            await tx.operationLine.update({
              where: { id: s.operationLineId },
              data: {
                slot: { block: s.block, bay: s.bay, row: s.row, tier: s.tier },
              },
            });
          await tx.yardPosition.updateMany({
            where: { id: { in: positions.map((p) => p.id) } },
            data: { isOccupied: true },
          });
          for (const { pos, line } of containerUpdates)
            await tx.yardContainer.update({
              where: { id: line.yardContainerId! },
              data: {
                yardPositionId: pos.id,
                yardId,
                status: YardContainerStatus.POSITIONING,
              },
            });
        },
        { maxWait: 20_000, timeout: 120_000 },
      );

      // WebSocket (règle 6, CLAUDE.md) : notifie chaque position occupée,
      // avec le vrai conteneur attaché quand il y en a un.
      const containerIdByPositionId = new Map(
        containerUpdates.map(({ pos, line }) => [pos.id, line.yardContainerId]),
      );
      for (const pos of positions) {
        this.yardMapGateway.emitPositionUpdated(tenantId, {
          yardId,
          block: pos.block,
          bay: pos.bay,
          row: pos.row,
          tier: pos.tier,
          isOccupied: true,
          containerId: containerIdByPositionId.get(pos.id) ?? null,
        });
      }

      await this.advanceOperationStatus(
        this.prisma,
        operationId,
        op.status,
        OperationStatus.CAPACITE_VALIDEE,
      );

      return { mode: 'icd', reserved: slots.length };
    }

    // mode='warehouse' : surface dans une zone entrepôt.
    if (!dto.zoneId)
      throw new BadRequestException('zoneId requis (mode=warehouse).');
    if (!dto.surfaceM2 || dto.surfaceM2 <= 0)
      throw new BadRequestException('surfaceM2 requis (mode=warehouse).');

    const zone = await this.prisma.storageZone.findUnique({
      where: { id: dto.zoneId },
      select: {
        id: true,
        code: true,
        label: true,
        surfaceM2: true,
        tenantId: true,
        yard: { select: { id: true, name: true } },
      },
    });
    if (!zone || zone.tenantId !== tenantId)
      throw new NotFoundException('Zone introuvable.');

    const fileLines = await this.prisma.shipmentLine.findMany({
      where: {
        shipmentFileId: op.shipmentFileId,
        status: { not: ShipmentLineStatus.OUT },
      },
      select: { id: true, surfaceM2: true, zoneId: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!op.lines.length && !fileLines.length)
      throw new BadRequestException(
        'Aucune cargaison à réserver — ajoutez les colis ou les conteneurs avant de valider la capacité.',
      );

    if (zone.surfaceM2) {
      const occupied = await this.prisma.shipmentLine.findMany({
        where: { zoneId: zone.id, status: { in: ['IN_STOCK', 'RESERVED'] } },
        select: { id: true, surfaceM2: true },
      });
      const slotOnly = await this.prisma.operationLine.findMany({
        where: {
          shipmentLineId: null,
          operationId: { not: operationId },
          operation: {
            tenantId,
            lines: { none: { shipmentLineId: { not: null } } },
          },
        },
        select: { operationId: true, slot: true },
      });
      const used =
        occupied.reduce((s, l) => s + (l.surfaceM2 ?? 0), 0) +
        warehouseSlotSurface(slotOnly, zone.id);
      // Cette opération remplace sa propre réservation : on la retire du
      // déjà-compté pour qu'une seconde confirmation (même surface) passe.
      const own = occupied
        .filter((l) => fileLines.some((f) => f.id === l.id))
        .reduce((s, l) => s + (l.surfaceM2 ?? 0), 0);
      const remaining = zone.surfaceM2 - used + own;
      if (dto.surfaceM2 > remaining)
        throw new BadRequestException(
          `Surface insuffisante dans la zone "${zone.label}" (disponible ${remaining.toFixed(1)} m²).`,
        );
    }

    const slot = {
      warehouseId: dto.warehouseId ?? zone.yard.id,
      warehouseName: zone.yard.name,
      zoneId: dto.zoneId,
      zoneCode: zone.code,
      zoneLabel: zone.label,
      surfaceM2: dto.surfaceM2,
    };
    const linked = new Set(
      op.lines.map((l) => l.shipmentLineId).filter((id): id is string => !!id),
    );
    // La surface confirmée est portée une seule fois (première ligne sans
    // surface, sinon la première ligne). Les autres gardent la leur.
    const carrierId =
      fileLines.find((l) => l.zoneId === dto.zoneId)?.id ?? fileLines[0]?.id;

    await this.prisma.$transaction(async (tx) => {
      for (const line of fileLines) {
        if (linked.has(line.id)) continue;
        await tx.operationLine.create({
          data: {
            operationId,
            shipmentLineId: line.id,
            role: OperationLineRole.OUTPUT,
            slot,
          },
        });
      }
      for (const line of op.lines) {
        await tx.operationLine.update({
          where: { id: line.id },
          data: { slot },
        });
      }
      for (const line of fileLines) {
        await tx.shipmentLine.update({
          where: { id: line.id },
          data: {
            yardId: dto.warehouseId ?? zone.yard.id,
            zoneId: dto.zoneId,
            ...(line.id === carrierId ? { surfaceM2: dto.surfaceM2 } : {}),
            ...(line.status === ShipmentLineStatus.PENDING
              ? { status: ShipmentLineStatus.RESERVED }
              : {}),
          },
        });
      }
      await this.advanceOperationStatus(
        tx,
        operationId,
        op.status,
        OperationStatus.CAPACITE_VALIDEE,
      );
    });

    return {
      mode: 'warehouse',
      reserved:
        op.lines.length + fileLines.filter((l) => !linked.has(l.id)).length,
    };
  }

  // ── Autorisation d'entrée : émission du Bon à Entrer (BAE) ──────────────
  // Miroir de authorizeEntry(id, data) côté frontend (dos-store.js).

  // Types où le passage Gate représente aussi l'arrivée physique de la
  // cargaison. Toutes les opérations ont désormais un BAE et un Gate In,
  // mais seules celles-ci font passer leurs unités à IN_YARD. Pour une
  // opération sortante, le Gate In concerne le camion venu charger.
  // DEP_TRANS/DEP_STOCK ont
  // désormais aussi un vrai Gate In séparé : leur conteneur est ANNONCÉ à la
  // création du dossier (WmsService.createFile(), announceOnly) puis
  // confirmé IN_YARD ici, avant que "Réception conteneur" (premier step
  // métier de leur pipeline) ne devienne exécutable. Les types sortants
  // (ICD_OUT/ENT_OUT/EMP_EXPORT/LOAD_EXPORT) se terminent par un Gate Out,
  // jamais un Gate In. Voir table OPERATION_TYPES (CLAUDE.md).
  private static readonly CARGO_ENTRY_TYPES: OperationType[] = [
    OperationType.ICD_FULL,
    OperationType.ICD_EMPTY,
    OperationType.ENT_IN,
    OperationType.DEP_TRANS,
    OperationType.DEP_STOCK,
  ];

  // Fait avancer Operation.status vers `target` SI ET SEULEMENT SI ça
  // représente un progrès réel (jamais de retour en arrière) — protège une
  // opération déjà avancée plus loin (ex. Gate In déjà fait) contre un appel
  // tardif à reserveCapacity()/authorizeEntry() (changement d'emplacement
  // après coup, réémission) qui ferait sinon régresser son statut affiché.
  private async advanceOperationStatus(
    tx: Prisma.TransactionClient | typeof this.prisma,
    operationId: string,
    currentStatus: OperationStatus,
    target: OperationStatus,
  ) {
    const currentIdx = OPERATION_STATUS_ORDER.indexOf(currentStatus);
    const targetIdx = OPERATION_STATUS_ORDER.indexOf(target);
    if (targetIdx <= currentIdx) return;
    await tx.operation.update({
      where: { id: operationId },
      data: { status: target },
    });
  }

  // Contrôle documentaire : le dépôt des fichiers est facultatif pour le moment.
  // Valider l'étape avance le statut sans exiger de pièce jointe.
  async validateDocuments(operationId: string, tenantId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      select: { id: true, status: true },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    await this.advanceOperationStatus(
      this.prisma,
      operationId,
      op.status,
      OperationStatus.DOCUMENTS_VALIDES,
    );
    return { ok: true };
  }

  async authorizeEntry(
    operationId: string,
    tenantId: string,
    userId: string,
    dto: EntryAuthorizationDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');

    // Contrat, compte et devis restent enregistrés s'ils sont cochés, mais
    // ne bloquent plus le Bon à Entrer. La finance les reprend ensuite.

    const year = new Date().getFullYear();
    const seq =
      (await this.prisma.operation.count({
        where: { tenantId, bonNumber: { not: null } },
      })) + 1;
    const bonNumber = `BAE-${year}-${String(seq).padStart(4, '0')}`;

    const statusIdx = OPERATION_STATUS_ORDER.indexOf(op.status);
    const targetIdx = OPERATION_STATUS_ORDER.indexOf(
      OperationStatus.AUTORISE_ENTREE,
    );
    const updated = await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        bonNumber,
        bonIssuedAt: (() => {
          const at = dto.issuedAt ? new Date(dto.issuedAt) : new Date();
          if (at.getTime() > Date.now() + 5 * 60_000)
            throw new BadRequestException(
              "La date du Bon à Entrer ne peut pas être dans le futur.",
            );
          return at;
        })(),
        bonIssuedById: userId,
        bonCheckContract: !!dto.checkContract,
        bonCheckAccount: !!dto.checkAccount,
        bonCheckQuote: !!dto.checkQuote,
        ...(targetIdx > statusIdx
          ? { status: OperationStatus.AUTORISE_ENTREE }
          : {}),
      },
    });
    return updated;
  }

  // ── Envoi du Bon à Entrer par e-mail ─────────────────────────────────────
  // Miroir de emailEntryPass(id, to, cc, message) côté frontend
  // (dos-store.js). Envoi HTML réel via MailService (Resend) — le message
  // n'est journalisé (EntryPassEmail) que si l'envoi a effectivement réussi,
  // pour ne pas faire croire à un envoi qui a échoué.

  async emailEntryPass(
    operationId: string,
    tenantId: string,
    userId: string,
    dto: EmailEntryPassDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      select: {
        id: true,
        bonNumber: true,
        bonIssuedAt: true,
        shipmentFile: {
          select: {
            id: true,
            voyageCode: true,
            eta: true,
            client: { select: { name: true } },
            lines: {
              select: {
                packageRef: true,
                description: true,
                packageType: { select: { label: true } },
                quantity: true,
                weightKg: true,
              },
            },
          },
        },
        lines: {
          where: { role: OperationLineRole.OUTPUT },
          select: {
            yardContainer: {
              select: {
                containerNumber: true,
                isoTypeCode: true,
                sizeFt: true,
                sealNumber: true,
                grossWeightKg: true,
              },
            },
          },
        },
      },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    if (!op.bonNumber)
      throw new BadRequestException('Aucun Bon à Entrer généré.');

    const to = dto.to
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!to.length)
      throw new BadRequestException('Renseignez au moins un destinataire.');
    const bad = to.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new BadRequestException(`Adresse e-mail invalide : ${bad}`);

    const cc = (dto.cc ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const badCc = cc.find((e) => !EMAIL_RE.test(e));
    if (badCc)
      throw new BadRequestException(`Adresse e-mail invalide (cc) : ${badCc}`);

    const containers = op.lines
      .map((l) => l.yardContainer)
      .filter((c): c is NonNullable<typeof c> => !!c);
    const html = this.buildEntryPassEmailHtml({
      bonNumber: op.bonNumber,
      bonIssuedAt: op.bonIssuedAt,
      voyageCode: op.shipmentFile.voyageCode,
      clientName: op.shipmentFile.client?.name ?? '—',
      message: dto.message,
      containers,
      packages: op.shipmentFile.lines,
    });

    const result = await this.mailService.sendRaw({
      to,
      cc,
      subject: `Bon à Entrer ${op.bonNumber} — ${op.shipmentFile.voyageCode}`,
      html,
    });
    if (!result.ok)
      throw new BadRequestException(
        `Échec de l'envoi de l'e-mail : ${result.error ?? 'erreur inconnue'}.`,
      );

    return this.prisma.entryPassEmail.create({
      data: {
        operationId,
        to,
        cc,
        message: dto.message,
        sentById: userId,
      },
    });
  }

  private buildEntryPassEmailHtml(data: {
    bonNumber: string;
    bonIssuedAt: Date | null;
    voyageCode: string;
    clientName: string;
    message?: string;
    containers: {
      containerNumber: string;
      isoTypeCode: string;
      sizeFt: number;
      sealNumber: string | null;
      grossWeightKg: number | null;
    }[];
    packages: {
      packageRef: string;
      description: string | null;
      packageType: { label: string };
      quantity: number;
      weightKg: number | null;
    }[];
  }): string {
    const issuedAt = data.bonIssuedAt
      ? new Date(data.bonIssuedAt).toLocaleString('fr-FR')
      : '—';
    const rows = data.containers.length
      ? data.containers
          .map(
            (c) => `
        <tr>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;font-family:monospace">${c.containerNumber}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9">${c.isoTypeCode} / ${c.sizeFt}'</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;font-family:monospace">${c.sealNumber ?? '—'}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;text-align:right">${c.grossWeightKg?.toLocaleString('fr-FR') ?? '—'}</td>
        </tr>`,
          )
          .join('')
      : data.packages
          .map(
            (p) => `
        <tr>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;font-family:monospace">${p.packageRef}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9">${p.description || p.packageType.label}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;text-align:right">${p.quantity}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;text-align:right">${p.weightKg?.toLocaleString('fr-FR') ?? '—'}</td>
        </tr>`,
          )
          .join('');
    const headCols = data.containers.length
      ? ['N° conteneur', 'Type/Taille', 'N° plomb', 'Poids (kg)']
      : ['Référence', 'Nature', 'Quantité', 'Poids (kg)'];

    return `
      <div style="font-family:Poppins,sans-serif;max-width:640px;margin:auto;padding:32px">
        <div style="background:linear-gradient(135deg,#003D80,#0050A0);padding:24px;border-radius:12px;margin-bottom:24px">
          <p style="color:white;font-size:20px;font-weight:700;margin:0">Bon à Entrer ${data.bonNumber}</p>
          <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:4px 0 0">DMT Hub Logistique — Dakar</p>
        </div>
        ${data.message ? `<p style="color:#334155;white-space:pre-line">${data.message}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin:16px 0">
          <tr>
            <td style="padding:4px 8px;color:#64748B">Client</td>
            <td style="padding:4px 8px;font-weight:600">${data.clientName}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;color:#64748B">Code voyage</td>
            <td style="padding:4px 8px">${data.voyageCode}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;color:#64748B">Émis le</td>
            <td style="padding:4px 8px">${issuedAt}</td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr>${headCols.map((h) => `<th style="text-align:left;border-bottom:1px solid #CBD5E1;padding:4px 8px;color:#64748B">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#64748B;font-size:11px;margin-top:24px">
          Le véhicule transportant cette cargaison est autorisé à se présenter au poste Gate de DMT Hub Logistique
          muni du présent document.
        </p>
        <hr style="border:none;border-top:1px solid #F1F5F9;margin:24px 0">
        <p style="color:#94A3B8;font-size:11px">© 2026 DMT Hub Logistique — YWMS</p>
      </div>
    `;
  }

  // ── Gate In : un passage camion (entrée partielle possible) ─────────────
  // Miroir de gateInDossier(id, data) côté frontend (dos-store.js).

  async gateIn(
    operationId: string,
    tenantId: string,
    userId: string,
    dto: GateInPassDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      include: { lines: true },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');

    const transport = await this.tmsService.resolveGateTransport(
      tenantId,
      dto,
    );

    // Les types qui reçoivent leur cargaison au Gate n'ont pas
    // d'input préexistant AU MOMENT DU GATE IN : le conteneur/la marchandise
    // qui arrive EST la ligne produite par l'annonce/la création (role=
    // OUTPUT — voir WmsService.createFile(), announceOnly). Pour DEP_TRANS/
    // DEP_STOCK, ce même conteneur redevient l'input réel du dépotage une
    // fois IN_YARD confirmé ici (leur pipeline métier démarre après ce Gate
    // In, voir "Réception conteneur") — mais au niveau OperationLine, il
    // reste modélisé OUTPUT de l'annonce, jamais réassigné en INPUT.
    const isCargoEntry = OperationsService.CARGO_ENTRY_TYPES.includes(op.type);
    const gateLines = op.lines.filter((l) =>
      isCargoEntry
        ? l.role === OperationLineRole.OUTPUT
        : l.role === OperationLineRole.INPUT,
    );
    // Unités déjà arrivées sur des passages précédents.
    const priorPasses = await this.prisma.gatePass.findMany({
      where: { operationId },
      select: { arrivedOperationLineIds: true },
    });
    const alreadyArrived = new Set(
      priorPasses.flatMap((p) => p.arrivedOperationLineIds),
    );
    const pendingIds = gateLines
      .map((l) => l.id)
      .filter((id) => !alreadyArrived.has(id));

    const arrived = (dto.arrivedOperationLineIds ?? pendingIds).filter((id) =>
      pendingIds.includes(id),
    );
    if (!arrived.length && pendingIds.length)
      throw new BadRequestException(
        'Sélectionnez au moins une unité présentée au Gate.',
      );

    const gateInAt = dto.gateInAt ? new Date(dto.gateInAt) : new Date();
    // Registre Gate : visite du camion sur site (indépendante du TMS).
    const visit = await this.gateRegistry.checkIn(
      tenantId,
      {
        plate: transport.truckPlate,
        carrier: transport.carrier,
        driverName: transport.driverName,
        driverCin: transport.driverCin,
        permitNo: transport.permitNo,
        tmsVehicleId: transport.vehicleId,
      },
      userId,
      gateInAt,
    );
    const pass = await this.prisma.gatePass.create({
      data: {
        operationId,
        truckVisitId: visit.id,
        transportMode: transport.transportMode,
        vehicleId: transport.vehicleId,
        driverId: transport.driverId,
        truckPlate: transport.truckPlate,
        carrier: transport.carrier,
        driverName: transport.driverName,
        driverCin: transport.driverCin,
        permitNo: transport.permitNo,
        arrivedOperationLineIds: arrived,
        createdById: userId,
        gateInDate: gateInAt,
      },
    });

    // Confirme l'arrivée physique des conteneurs de CE passage — c'est ICI,
    // et seulement ici, que le statut passe à IN_YARD (jamais à
    // reserveCapacity(), qui ne fait que réserver l'emplacement CIBLE, voir
    // son commentaire — ni à authorizeEntry(), qui n'émet qu'un document).
    // Repasse aussi par le vrai yardPositionId (déjà posé par
    // reserveCapacity() en POSITIONING) : la position devient enfin visible
    // sur le plan du yard/Parc conteneurs (voir YmsService.getYardMap(), qui
    // exclut explicitement POSITIONING).
    const arrivedContainerIds = gateLines
      .filter((l) => arrived.includes(l.id))
      .map((l) => l.yardContainerId)
      .filter((cid): cid is string => !!cid);
    if (isCargoEntry && arrivedContainerIds.length) {
      await this.prisma.yardContainer.updateMany({
        where: { id: { in: arrivedContainerIds } },
        data: { status: YardContainerStatus.IN_YARD, gateInDate: gateInAt },
      });
      const positioned = await this.prisma.yardContainer.findMany({
        where: {
          id: { in: arrivedContainerIds },
          yardPositionId: { not: null },
        },
        select: { id: true, yardPosition: true },
      });
      for (const c of positioned) {
        if (c.yardPosition) {
          this.yardMapGateway.emitPositionUpdated(tenantId, {
            yardId: c.yardPosition.yardId,
            block: c.yardPosition.block,
            bay: c.yardPosition.bay,
            row: c.yardPosition.row,
            tier: c.yardPosition.tier,
            isOccupied: true,
            containerId: c.id,
          });
        }
      }
    }

    // Colis d'une réception entrepôt (ENT_IN) : créés PENDING (attendus,
    // voir WmsService.createFile()/addCargo()), ils deviennent réellement
    // en stock à leur arrivée au Gate — même rôle que le passage IN_YARD
    // des conteneurs ci-dessus. RESERVED = emplacement réservé à l'étape
    // Capacité, toujours pas physiquement arrivé.
    if (op.type === OperationType.ENT_IN) {
      const arrivedShipmentLineIds = gateLines
        .filter((l) => arrived.includes(l.id))
        .map((l) => l.shipmentLineId)
        .filter((sid): sid is string => !!sid);
      if (arrivedShipmentLineIds.length)
        await this.prisma.shipmentLine.updateMany({
          where: {
            id: { in: arrivedShipmentLineIds },
            status: {
              in: [ShipmentLineStatus.PENDING, ShipmentLineStatus.RESERVED],
            },
          },
          data: { status: ShipmentLineStatus.IN_STOCK },
        });
    }

    const remaining = pendingIds.length - arrived.length;
    const complete = remaining === 0;
    if (complete) {
      await this.advanceOperationStatus(
        this.prisma,
        operationId,
        op.status,
        OperationStatus.GATE_IN,
      );
    }

    await this.tmsService.markInUse(
      transport.vehicleId ?? null,
      transport.driverId ?? null,
    );

    // Une course effectuée par la flotte interne devient immédiatement une
    // prestation facturable du dossier. Ligne manuelle (mandatory=null) :
    // elle ne sera pas supprimée par une résolution ultérieure des services
    // induits. Le tarif T-SRV-07 reste administrable dans le référentiel.
    if (transport.transportMode === FleetOwnership.INTERNAL) {
      const tariff = await this.prisma.tariffRef.findFirst({
        where: { tenantId, code: 'T-SRV-07', isActive: true },
      });
      await this.prisma.shipmentFileServiceLine.create({
        data: {
          shipmentFileId: op.shipmentFileId,
          tenantId,
          tariffId: tariff?.id,
          label: `Transport interne — ${transport.truckPlate}`,
          unit: tariff?.unit || 'course',
          quantity: 1,
          rate: tariff?.rate || 0,
          mandatory: null,
          displayMandatory: false,
          ruleLabel: `TMS_GATE_IN:${pass.id}`,
        },
      });
    }
    return { pass, remaining, complete };
  }

  // Correction d'un GatePass déjà enregistré — pour l'instant seule la date/
  // heure réelle est modifiable (voir UpdateGatePassDto). Répercute la
  // correction sur YardContainer.gateInDate des conteneurs arrivés sur CE
  // passage précis (arrivedOperationLineIds déjà stocké sur le GatePass),
  // pour rester cohérent avec ce que gateIn() pose à la création.
  async updateGatePass(
    passId: string,
    tenantId: string,
    dto: UpdateGatePassDto,
  ) {
    const pass = await this.prisma.gatePass.findFirst({
      where: { id: passId, operation: { tenantId } },
    });
    if (!pass) throw new NotFoundException('Passage Gate introuvable.');

    const gateInAt = dto.gateInAt ? new Date(dto.gateInAt) : pass.gateInDate;
    if (gateInAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date du passage ne peut pas être dans le futur.',
      );

    // Unités du passage : on peut en retirer, ou en reprendre d'un autre
    // passage de la même opération (erreur d'affectation camion/conteneur).
    let arrived = pass.arrivedOperationLineIds;
    if (dto.arrivedOperationLineIds) {
      const opLines = await this.prisma.operationLine.findMany({
        where: { operationId: pass.operationId },
        select: { id: true },
      });
      const valid = new Set(opLines.map((l) => l.id));
      const bad = dto.arrivedOperationLineIds.filter((id) => !valid.has(id));
      if (bad.length)
        throw new BadRequestException(
          "Une unité choisie n'appartient pas à cette opération.",
        );
      arrived = [...new Set(dto.arrivedOperationLineIds)];
      if (!arrived.length)
        throw new BadRequestException(
          'Un passage doit garder au moins une unité.',
        );
      const others = await this.prisma.gatePass.findMany({
        where: { operationId: pass.operationId, id: { not: passId } },
        select: { id: true, arrivedOperationLineIds: true },
      });
      // Une unité ne peut être que sur un seul passage.
      for (const o of others) {
        const keep = o.arrivedOperationLineIds.filter(
          (id) => !arrived.includes(id),
        );
        if (keep.length !== o.arrivedOperationLineIds.length)
          await this.prisma.gatePass.update({
            where: { id: o.id },
            data: { arrivedOperationLineIds: keep },
          });
      }
      // Unités retirées et rattachées à aucun autre passage : de nouveau
      // « attendues au Gate » (un nouveau Gate In pourra être saisi), sauf
      // si le conteneur est déjà sorti.
      const stillArrived = new Set(
        (
          await this.prisma.gatePass.findMany({
            where: { operationId: pass.operationId, id: { not: passId } },
            select: { arrivedOperationLineIds: true },
          })
        ).flatMap((p) => p.arrivedOperationLineIds),
      );
      const orphans = pass.arrivedOperationLineIds.filter(
        (id) => !arrived.includes(id) && !stillArrived.has(id),
      );
      if (orphans.length) {
        const orphanBoxes = await this.prisma.operationLine.findMany({
          where: { id: { in: orphans }, yardContainerId: { not: null } },
          select: {
            yardContainer: { select: { id: true, status: true, yardPositionId: true } },
          },
        });
        for (const { yardContainer: c } of orphanBoxes) {
          if (!c || c.status !== YardContainerStatus.IN_YARD) continue;
          await this.prisma.yardContainer.update({
            where: { id: c.id },
            data: {
              status: c.yardPositionId
                ? YardContainerStatus.POSITIONING
                : YardContainerStatus.GATE_IN_PROGRESS,
              gateInDate: null,
            },
          });
        }
      }
    }

    const plate = dto.truckPlate?.trim().toUpperCase();
    const updated = await this.prisma.gatePass.update({
      where: { id: passId },
      data: {
        gateInDate: gateInAt,
        arrivedOperationLineIds: arrived,
        ...(plate ? { truckPlate: plate } : {}),
        ...(dto.carrier !== undefined ? { carrier: dto.carrier.trim() || null } : {}),
        ...(dto.driverName ? { driverName: dto.driverName.trim() } : {}),
        ...(dto.driverCin ? { driverCin: dto.driverCin.trim() } : {}),
        ...(dto.permitNo ? { permitNo: dto.permitNo.trim() } : {}),
      },
    });

    const containerIds = (
      await this.prisma.operationLine.findMany({
        where: { id: { in: arrived } },
        select: { yardContainerId: true },
      })
    )
      .map((l) => l.yardContainerId)
      .filter((cid): cid is string => !!cid);
    if (containerIds.length) {
      await this.prisma.yardContainer.updateMany({
        where: { id: { in: containerIds } },
        data: { gateInDate: gateInAt },
      });
      // Conteneur rattaché à ce passage alors qu'il était « attendu » (retiré
      // d'un autre passage) : il est bien entré → de nouveau en yard.
      await this.prisma.yardContainer.updateMany({
        where: {
          id: { in: containerIds },
          status: {
            in: [YardContainerStatus.POSITIONING, YardContainerStatus.GATE_IN_PROGRESS],
          },
        },
        data: { status: YardContainerStatus.IN_YARD },
      });
    }

    // Répercute la correction sur le début de facturation du séjour — SEULEMENT
    // si le séjour est encore en cours (pas déjà clôturé au Gate Out, où
    // storageBillableDays a été figé pour la facture déjà émise, voir §15).
    // Sinon la correction reste silencieusement sans effet sur la facturation
    // passée, cohérent avec le choix de ne pas altérer une période déjà
    // facturée/close.
    const operation = await this.prisma.operation.findUnique({
      where: { id: pass.operationId },
      select: { storageBillingStartedAt: true, storageBillingEndedAt: true },
    });
    if (
      operation?.storageBillingStartedAt &&
      !operation.storageBillingEndedAt &&
      containerIds.length
    ) {
      const allGateInDates = await this.prisma.yardContainer.findMany({
        where: {
          operationLines: { some: { operationId: pass.operationId } },
          gateInDate: { not: null },
        },
        select: { gateInDate: true },
      });
      const dates = allGateInDates
        .map((c) => c.gateInDate)
        .filter((d): d is Date => !!d);
      if (dates.length) {
        const newStart = new Date(Math.min(...dates.map((d) => d.getTime())));
        if (
          newStart.getTime() !== operation.storageBillingStartedAt.getTime()
        ) {
          await this.prisma.operation.update({
            where: { id: pass.operationId },
            data: { storageBillingStartedAt: newStart },
          });
        }
      }
    }

    return updated;
  }

  // ── Inspection d'une unité (EIR) ─────────────────────────────────────────
  // Miroir de inspectUnit(id, lineId, insp) côté frontend (dos-store.js).

  async inspectUnit(
    operationLineId: string,
    tenantId: string,
    userId: string,
    dto: InspectUnitDto,
  ) {
    const line = await this.prisma.operationLine.findFirst({
      where: { id: operationLineId, operation: { tenantId } },
      select: { id: true, shipmentLineId: true, yardContainerId: true },
    });
    if (!line) throw new NotFoundException('Unité introuvable.');

    const referenceType = line.shipmentLineId
      ? 'SHIPMENT_LINE'
      : 'YARD_CONTAINER';
    const referenceId = line.shipmentLineId ?? line.yardContainerId;
    if (!referenceId)
      throw new BadRequestException(
        "Cette unité de pipeline n'est rattachée à aucune ligne ni conteneur.",
      );

    // Référence lisible auto-générée — jamais saisie manuellement côté
    // frontend (voir OpStepProcedure, op-procedures.jsx). Même schéma que
    // bonNumber (BAE-<année>-<séquence>) pour rester cohérent.
    const year = new Date().getFullYear();
    const seq = (await this.prisma.eIR.count({ where: { tenantId } })) + 1;
    const reference = `EIR-${year}-${String(seq).padStart(6, '0')}`;

    return this.prisma.eIR.create({
      data: {
        tenantId,
        reference,
        referenceType,
        referenceId,
        type: dto.type ?? 'ENTRY',
        checks: dto.checks ?? [],
        condition: dto.condition ?? 'GOOD',
        description: dto.description,
        photos: dto.photos ?? [],
        generatedById: userId,
      },
    });
  }

  // ── Changement d'emplacement : demande + décision ────────────────────────
  // Miroir de requestSlotChange()/decideApproval() côté frontend
  // (dos-store.js). L'auteur peut appliquer directement s'il est le
  // créateur du dossier (approximé ici par l'auteur de la soumission N+1 de
  // l'opération initiale — ShipmentFile n'a pas de createdById dédié) ou un
  // rôle DEX/ADMIN/SUPER_ADMIN ; sinon la demande passe en approbation.

  private async isDossierActor(
    fileId: string,
    tenantId: string,
    userId: string,
    userRole: UserRole,
  ) {
    if (DEX_ROLES.includes(userRole)) return true;
    if (await this.access.hasAny(userId, userRole, ['dossiers.validate.dex'])) return true;
    const initial = await this.prisma.operation.findFirst({
      where: { shipmentFileId: fileId, tenantId },
      orderBy: { createdAt: 'asc' },
      select: { submittedById: true },
    });
    return !!initial?.submittedById && initial.submittedById === userId;
  }

  async requestSlotChange(
    operationLineId: string,
    tenantId: string,
    userId: string,
    userRole: UserRole,
    dto: SlotChangeRequestDto,
  ) {
    const line = await this.prisma.operationLine.findFirst({
      where: { id: operationLineId, operation: { tenantId } },
      select: {
        id: true,
        operationId: true,
        slot: true,
        operation: { select: { shipmentFileId: true } },
      },
    });
    if (!line) throw new NotFoundException('Unité introuvable.');

    const canApplyDirectly = await this.isDossierActor(
      line.operation.shipmentFileId,
      tenantId,
      userId,
      userRole,
    );

    if (canApplyDirectly) {
      await this.prisma.operationLine.update({
        where: { id: operationLineId },
        data: { slot: dto.toSlot as Prisma.InputJsonValue },
      });
      return { applied: true };
    }

    const approval = await this.prisma.slotChangeApproval.create({
      data: {
        operationId: line.operationId,
        operationLineId,
        fromSlot: (line.slot as Prisma.InputJsonValue) ?? undefined,
        toSlot: dto.toSlot as Prisma.InputJsonValue,
        reason: dto.reason,
        status: SlotChangeStatus.PENDING,
        requestedById: userId,
      },
    });
    return { applied: false, pending: true, approval };
  }

  async decideSlotChange(
    approvalId: string,
    tenantId: string,
    userId: string,
    userRole: UserRole,
    dto: DecideSlotChangeDto,
  ) {
    const approval = await this.prisma.slotChangeApproval.findFirst({
      where: { id: approvalId, operation: { tenantId } },
      include: { operation: { select: { shipmentFileId: true } } },
    });
    if (!approval) throw new NotFoundException('Demande introuvable.');
    if (approval.status !== SlotChangeStatus.PENDING)
      throw new BadRequestException('Cette demande a déjà été traitée.');

    const canDecide = await this.isDossierActor(
      approval.operation.shipmentFileId,
      tenantId,
      userId,
      userRole,
    );
    if (!canDecide)
      throw new ForbiddenException(
        'Décision réservée au créateur du dossier ou au DEX.',
      );

    const [updated] = await this.prisma.$transaction([
      this.prisma.slotChangeApproval.update({
        where: { id: approvalId },
        data: {
          status: dto.approve
            ? SlotChangeStatus.APPROVED
            : SlotChangeStatus.REJECTED,
          decidedById: userId,
          decidedAt: new Date(),
          comment: dto.comment,
        },
      }),
      ...(dto.approve
        ? [
            this.prisma.operationLine.update({
              where: { id: approval.operationLineId },
              data: { slot: approval.toSlot as Prisma.InputJsonValue },
            }),
          ]
        : []),
    ]);
    return updated;
  }

  async validateDex(operationId: string, tenantId: string, userId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');

    return this.prisma.operation.update({
      where: { id: operationId },
      data: { dexValidatedAt: new Date(), dexValidatedById: userId },
    });
  }

  async advance(
    operationId: string,
    tenantId: string,
    userId: string,
    userRole: UserRole,
    dto: AdvanceOperationDto,
  ) {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      include: {
        shipmentFile: {
          select: {
            id: true,
            defaultYardId: true,
            entryDate: true,
            voyageCode: true,
            clientRef: true,
            payment: { select: { status: true } },
            client: {
              select: { defaultFreetimeDays: true, truckFreetimeHours: true },
            },
          },
        },
        lines: {
          include: {
            // Quantité ATTENDUE (kind='tally') — comparée à
            // OperationLine.quantity (constaté) sans dupliquer la valeur.
            shipmentLine: { select: { quantity: true } },
            // Date réelle d'entrée (kind='placement') — démarre la
            // facturation du séjour à la VRAIE date de Gate In, pas au
            // moment où le placement est traité côté staff (voir plus bas).
            yardContainer: {
              select: {
                gateInDate: true,
                yardPositionId: true,
                sealNumber: true,
                status: true,
                containerType: true,
              },
            },
          },
        },
      },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');

    const cfg = OPERATION_TYPE_CFG[op.type];
    const data = dto.data;
    // Date RÉELLE de réalisation (saisie à l'étape, défaut maintenant) —
    // utilisée pour le journal et les dates métier écrites par l'étape.
    const performedAt = dto.performedAt ? new Date(dto.performedAt) : new Date();
    if (performedAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        "La date de réalisation de l'étape ne peut pas être dans le futur.",
      );

    // Périmètre : lignes non terminées, filtrées sur operationLineIds si fourni.
    const scope = op.lines
      .filter((l) => !l.done)
      .filter(
        (l) => !dto.operationLineIds || dto.operationLineIds.includes(l.id),
      );
    if (!scope.length)
      throw new BadRequestException(
        'Aucune unité disponible et non terminée pour cette étape.',
      );

    // Toutes les unités du périmètre doivent être à la même étape.
    const idxs = [...new Set(scope.map((l) => l.stepIdx))];
    if (idxs.length > 1)
      throw new BadRequestException(
        'Les unités sélectionnées ne sont pas à la même étape — traitez-les séparément.',
      );
    const at = idxs[0];
    if (at >= cfg.steps.length)
      throw new BadRequestException('Cette opération est déjà terminée.');
    const label = cfg.steps[at];
    // Envoi rejoué : les unités ont déjà franchi l'étape visée.
    if (dto.expectedStepIdx != null && dto.expectedStepIdx !== at)
      throw new ConflictException(
        `Étape déjà enregistrée : les unités sont maintenant à « ${label} » (étape ${at + 1}). Rechargez le dossier avant de continuer.`,
      );
    // Le type envoyé doit être celui de l'étape en cours (sinon les données
    // de l'étape sont perdues et l'étape avance quand même).
    const expectedKind = stepKindOf(label);
    if (dto.kind && dto.kind !== expectedKind)
      throw new BadRequestException(
        `L'étape en cours est « ${label} » (type ${expectedKind}) — le type envoyé (${dto.kind}) ne correspond pas.`,
      );
    const kind = expectedKind;
    const isLastStep = at === cfg.steps.length - 1;

    // Blocage §15 : la dernière étape d'une opération sortante exige
    // validation Finance (Payment.status=VALIDATED) puis validation DEX.
    if (cfg.dir === 'OUT' && isLastStep) {
      const finOk = op.shipmentFile.payment?.status === PaymentStatus.VALIDATED;
      if (!finOk)
        throw new BadRequestException(
          'Blocage §15 — la validation financière du dossier est requise avant la sortie.',
        );
      if (!op.dexValidatedAt)
        throw new BadRequestException(
          'Blocage §15 — la validation DEX est requise avant la sortie.',
        );
    }

    const nextIdx = at + 1;
    const done = nextIdx >= cfg.steps.length;

    // ── Effets de bord métier par `kind` — additifs à l'avancement générique
    // ci-dessous. Miroir de executeOpStep() côté frontend (dos-store.js).
    const scopeIds = scope.map((l) => l.id);
    const extraWrites: Prisma.PrismaPromise<unknown>[] = [];
    let stayAlertToSchedule: {
      shipmentFileId: string;
      tenantId: string;
      voyageCode: string;
      clientRef: string | null;
      storageStartedAt: Date;
      freetimeDays: number;
    } | null = null;
    // Positions yard fraîchement occupées par ce kind='placement' — notifiées
    // au plan du yard (règle 6, CLAUDE.md) une fois la transaction validée.
    const occupiedPositions: Array<{
      id: string;
      block: string;
      bay: number;
      row: number;
      tier: number;
    }> = [];
    const freedPositions: Array<{
      yardId: string;
      block: string;
      bay: number;
      row: number;
      tier: number;
    }> = [];

    // Moyens mobilisés (engin, équipe de manutention) — enregistrés sur les
    // unités du périmètre (valeur courante) ET dans le journal de l'étape
    // (historique, voir createMany plus bas).
    const equipmentName = data?.equipment?.trim() || null;
    const crew = data?.handlingCrew;
    if (crew?.type === HandlingCrewType.DOCKERS && !crew.count)
      throw new BadRequestException('Indiquez le nombre de dockers mobilisés.');
    const crewCount =
      crew?.type === HandlingCrewType.DOCKERS ? (crew.count ?? null) : null;
    if (kind === 'grounding' && !equipmentName)
      throw new BadRequestException(
        "L'engin de manutention est requis pour la mise à terre.",
      );
    if (equipmentName || crew || kind === 'grounding') {
      extraWrites.push(
        this.prisma.operationLine.updateMany({
          where: { id: { in: scopeIds } },
          data: {
            ...(equipmentName ? { equipmentName } : {}),
            ...(crew
              ? { handlingCrewType: crew.type, handlingCrewCount: crewCount }
              : {}),
            ...(kind === 'grounding' ? { groundedAt: performedAt } : {}),
          },
        }),
      );
    }

    if (kind === 'placement') {
      if (!op.storageBillingStartedAt) {
        // Démarre le décompte à la VRAIE date d'entrée — pas au moment où
        // le placement est traité côté staff (qui peut suivre le Gate In
        // réel de plusieurs jours). La plus ancienne date d'entrée parmi
        // les unités du scope fait foi (premier conteneur/colis entré) ;
        // repli sur ShipmentFile.entryDate pour les dossiers CV (pas de
        // YardContainer/GatePass), puis sur now() en dernier recours si
        // aucune date réelle n'est connue.
        const realEntryDates = scope
          .map((l) => l.yardContainer?.gateInDate)
          .filter((d): d is Date => !!d);
        const storageStart =
          realEntryDates.length > 0
            ? new Date(Math.min(...realEntryDates.map((d) => d.getTime())))
            : (op.shipmentFile.entryDate ?? new Date());
        const freetimeDays =
          data?.freetimeDaysOverride ??
          op.storageFreetimeDays ??
          op.shipmentFile.client?.defaultFreetimeDays ??
          0;
        extraWrites.push(
          this.prisma.operation.update({
            where: { id: operationId },
            data: {
              storageBillingStartedAt: storageStart,
              storageFreetimeDays: freetimeDays,
            },
          }),
        );
        stayAlertToSchedule = {
          shipmentFileId: op.shipmentFile.id,
          tenantId,
          voyageCode: op.shipmentFile.voyageCode,
          clientRef: op.shipmentFile.clientRef ?? null,
          storageStartedAt: storageStart,
          freetimeDays,
        };
      }

      if (data?.slots?.length) {
        const canChangeSlot = await this.isDossierActor(
          op.shipmentFile.id,
          tenantId,
          userId,
          userRole,
        );
        const yardId = op.shipmentFile.defaultYardId;
        for (const s of data.slots) {
          if (!scopeIds.includes(s.operationLineId)) continue;
          const line = scope.find((l) => l.id === s.operationLineId);
          const newSlot = {
            block: s.block,
            bay: s.bay,
            row: s.row,
            tier: s.tier,
          };
          if (line?.slot && !canChangeSlot) {
            // Unité déjà placée et l'auteur n'est ni créateur du dossier ni
            // DEX/ADMIN/SUPER_ADMIN → passe en file d'approbation, on saute
            // la mise à jour directe pour cette ligne.
            extraWrites.push(
              this.prisma.slotChangeApproval.create({
                data: {
                  operationId,
                  operationLineId: s.operationLineId,
                  fromSlot: line.slot,
                  toSlot: newSlot,
                  status: SlotChangeStatus.PENDING,
                  requestedById: userId,
                },
              }),
            );
          } else {
            extraWrites.push(
              this.prisma.operationLine.update({
                where: { id: s.operationLineId },
                data: { slot: newSlot },
              }),
            );
            // Emplacement yard réel (block/bay/row/tier) → marquer occupé et
            // notifier le plan du yard (règle 6, CLAUDE.md), même chemin que
            // reserveCapacity().
            if (yardId) {
              const pos = await this.prisma.yardPosition.findUnique({
                where: {
                  yardId_block_bay_row_tier: {
                    yardId,
                    block: s.block,
                    bay: s.bay,
                    row: s.row,
                    tier: s.tier,
                  },
                },
              });
              if (pos) {
                const containerId = line?.yardContainerId;
                const previousId = line?.yardContainer?.yardPositionId;
                if (containerId) {
                  extraWrites.push(
                    this.prisma.yardContainer.update({
                      where: { id: containerId },
                      data: { yardPositionId: pos.id, yardId },
                    }),
                  );
                  if (previousId && previousId !== pos.id) {
                    const previous = await this.prisma.yardPosition.findUnique({
                      where: { id: previousId },
                      select: {
                        yardId: true,
                        block: true,
                        bay: true,
                        row: true,
                        tier: true,
                      },
                    });
                    extraWrites.push(
                      this.prisma.yardPosition.update({
                        where: { id: previousId },
                        data: { isOccupied: false },
                      }),
                    );
                    if (previous) freedPositions.push(previous);
                  }
                }
                if (!pos.isOccupied) {
                  extraWrites.push(
                    this.prisma.yardPosition.update({
                      where: { id: pos.id },
                      data: { isOccupied: true },
                    }),
                  );
                  occupiedPositions.push(pos);
                }
              }
            }
          }
        }
      }
    }

    // Réception entrepôt (DEP_STOCK) : enregistre RÉELLEMENT l'entrepôt/la
    // zone choisis. Avant, le formulaire proposait une liste figée (mock
    // data-bonded) et rien n'était persisté : l'étape ne faisait qu'avancer
    // stepIdx. Les colis du dossier sont rattachés à la zone et passent
    // RESERVED ; ils deviennent IN_STOCK à « Placement & mise en stock ».
    if (kind === 'whreception') {
      const rec = data?.warehouseReception;
      if (!rec)
        throw new BadRequestException(
          "L'entrepôt et la zone de réception sont requis.",
        );
      const zone = await this.prisma.storageZone.findFirst({
        where: { id: rec.zoneId, tenantId },
        select: {
          id: true,
          code: true,
          label: true,
          yard: { select: { id: true, name: true } },
        },
      });
      if (!zone || zone.yard.id !== rec.warehouseId)
        throw new BadRequestException(
          "Cette zone n'appartient pas à l'entrepôt sélectionné.",
        );
      const slot = {
        warehouseId: zone.yard.id,
        warehouseName: zone.yard.name,
        zoneId: zone.id,
        zoneCode: zone.code,
        zoneLabel: zone.label,
        surfaceM2: rec.surfaceM2 ?? null,
      };
      extraWrites.push(
        this.prisma.operationLine.updateMany({
          where: { id: { in: scopeIds } },
          data: { slot },
        }),
        this.prisma.shipmentLine.updateMany({
          where: {
            shipmentFileId: op.shipmentFile.id,
            status: {
              in: [ShipmentLineStatus.PENDING, ShipmentLineStatus.RESERVED],
            },
          },
          data: {
            yardId: zone.yard.id,
            zoneId: zone.id,
            status: ShipmentLineStatus.RESERVED,
          },
        }),
      );
    }

    // Mise en stock effective des colis dépotés (DEP_STOCK) — sans cela ils
    // restaient PENDING/RESERVED pour toujours : jamais « En stock », jamais
    // éligibles à une sortie (requiresInput 'lines_in_stock').
    if (kind === 'placement' && op.type === OperationType.DEP_STOCK) {
      extraWrites.push(
        this.prisma.shipmentLine.updateMany({
          where: {
            shipmentFileId: op.shipmentFile.id,
            status: {
              in: [ShipmentLineStatus.PENDING, ShipmentLineStatus.RESERVED],
            },
          },
          data: { status: ShipmentLineStatus.IN_STOCK },
        }),
      );
    }

    // Fin du dépotage (« Déchargement » en transbordement, « Dépotage » en
    // mise en stock) : le conteneur est vidé → il passe VIDE tout de suite
    // (parc, plan du yard, franchise « vides »), sans attendre son retour.
    const isDepotageOp =
      op.type === OperationType.DEP_TRANS || op.type === OperationType.DEP_STOCK;
    if (kind === 'unload' && isDepotageOp) {
      const containerIds = scope
        .map((l) => l.yardContainerId)
        .filter((id): id is string => !!id);
      if (containerIds.length)
        extraWrites.push(
          this.prisma.yardContainer.updateMany({
            where: { id: { in: containerIds }, tenantId },
            data: { containerType: 'EMPTY' },
          }),
        );
    }

    // Pointage contradictoire par référence de colis (en plus du total par
    // unité) — quantité constatée portée sur chaque colis du dossier.
    if (data?.packageTally?.length) {
      const ids = data.packageTally.map((p) => p.shipmentLineId);
      const owned = await this.prisma.shipmentLine.count({
        where: { id: { in: ids }, shipmentFileId: op.shipmentFile.id },
      });
      if (owned !== new Set(ids).size)
        throw new BadRequestException(
          "Un colis pointé n'appartient pas à ce dossier.",
        );
      const countedAt = performedAt;
      for (const p of data.packageTally)
        extraWrites.push(
          this.prisma.shipmentLine.update({
            where: { id: p.shipmentLineId },
            data: { countedQuantity: p.counted, countedAt },
          }),
        );
    }

    // Pointage contradictoire : étape « Pointage » ET toute étape qui porte
    // un comptage (Déchargement / Dépotage, Picking, Chargement…) — avant, seul
    // kind='tally' enregistrait les colis constatés : ceux saisis au
    // déchargement étaient perdus (écart jamais calculé).
    const TALLY_KINDS = ['tally', 'unload', 'picking', 'load'];
    if (kind === 'tally' || (TALLY_KINDS.includes(kind) && data?.tally?.length)) {
      if (!data?.tally?.length)
        throw new BadRequestException(
          'Le comptage contradictoire est requis pour chaque unité du périmètre.',
        );
      const missing = scopeIds.filter(
        (id) => !data.tally!.some((t) => t.operationLineId === id),
      );
      if (missing.length)
        throw new BadRequestException(
          `Comptage manquant pour ${missing.length} unité(s) du périmètre.`,
        );
      for (const t of data.tally) {
        if (!scopeIds.includes(t.operationLineId)) continue;
        extraWrites.push(
          this.prisma.operationLine.update({
            where: { id: t.operationLineId },
            data: { quantity: t.counted },
          }),
        );
      }
    }

    if (kind === 'quality') {
      if (!data?.qualityChecks?.length)
        throw new BadRequestException(
          'Le résultat du contrôle qualité est requis pour chaque unité du périmètre.',
        );
      const missing = scopeIds.filter(
        (id) => !data.qualityChecks!.some((q) => q.operationLineId === id),
      );
      if (missing.length)
        throw new BadRequestException(
          `Résultat de contrôle qualité manquant pour ${missing.length} unité(s) du périmètre.`,
        );
      for (const q of data.qualityChecks) {
        if (!scopeIds.includes(q.operationLineId)) continue;
        extraWrites.push(
          this.prisma.operationLine.update({
            where: { id: q.operationLineId },
            data: {
              qualityResult: q.result,
              qualityNc: q.nc,
              qualityCheckedAt: performedAt,
            },
          }),
        );
      }
    }

    if (kind === 'doc') {
      if (!data?.docs?.length)
        throw new BadRequestException(
          'Le n° de document est requis pour chaque unité du périmètre.',
        );
      const missing = scopeIds.filter(
        (id) => !data.docs!.some((d) => d.operationLineId === id),
      );
      if (missing.length)
        throw new BadRequestException(
          `Document manquant pour ${missing.length} unité(s) du périmètre.`,
        );
      for (const doc of data.docs) {
        if (!scopeIds.includes(doc.operationLineId)) continue;
        extraWrites.push(
          this.prisma.operationLine.update({
            where: { id: doc.operationLineId },
            data: {
              docNumber: doc.docNumber,
              docSentTo: doc.sentTo,
              docIssuedAt: performedAt,
            },
          }),
        );
      }
    }

    if (kind === 'report') {
      if (!data?.reports?.length)
        throw new BadRequestException(
          'Le rapport contradictoire est requis pour chaque unité du périmètre.',
        );
      const missing = scopeIds.filter(
        (id) => !data.reports!.some((r) => r.operationLineId === id),
      );
      if (missing.length)
        throw new BadRequestException(
          `Rapport manquant pour ${missing.length} unité(s) du périmètre.`,
        );
      for (const r of data.reports) {
        if (!scopeIds.includes(r.operationLineId)) continue;
        extraWrites.push(
          this.prisma.operationLine.update({
            where: { id: r.operationLineId },
            data: {
              reportNumber: r.reportNumber,
              reportReceived: r.received,
              reportSignDmt: r.signDmt,
              reportSignThird: r.signThird,
              reportIssuedAt: performedAt,
            },
          }),
        );
      }
    }

    // Le retour du conteneur vide n'écrit QUE sur le conteneur (bloc
    // emptyreturn ci-dessous) : il écrasait auparavant pickup*/gateOut* de
    // la ligne, c.-à-d. le camion de reprise qui avait emporté la
    // marchandise et sa date de sortie (traçabilité et détention faussées).
    // Transbordement par chargements partiels (Chargements camions) : l'étape
    // ne se valide que si chaque conteneur est entièrement chargé, ou si le
    // reste est explicitement soldé. Le plan de chargement « un camion par
    // conteneur » (data.loadplan) reste accepté tel quel.
    if (kind === 'transship' && !data?.loadplan?.length) {
      const loads = await this.prisma.truckLoadLine.groupBy({
        by: ['operationLineId'],
        where: {
          operationLineId: { in: scopeIds },
          truckLoad: { status: { not: TruckLoadStatus.CANCELLED } },
        },
        _sum: { quantity: true },
      });
      const loaded = new Map(
        loads.map((r) => [r.operationLineId, r._sum.quantity ?? 0]),
      );
      const empty = scope.filter((l) => !loaded.get(l.id));
      if (empty.length)
        throw new BadRequestException(
          `${empty.length} unité(s) sans aucun chargement camion — enregistrez les chargements avant de valider l'étape.`,
        );
      const partial = scope.filter(
        (l) => l.quantity != null && (loaded.get(l.id) ?? 0) < l.quantity,
      );
      if (partial.length && !data?.closeBalance)
        throw new BadRequestException(
          `${partial.length} unité(s) partiellement chargée(s) — chargez le reste ou cochez « Solder le reste ».`,
        );
    }

    if (kind === 'gateout') {
      // Sortie camion avec chargements partiels : chaque camion chargé sur
      // cette unité doit être sorti (Chargements camions) avant la sortie.
      const stillOnSite = await this.prisma.truckLoadLine.findMany({
        where: {
          operationLineId: { in: scopeIds },
          truckLoad: { status: TruckLoadStatus.LOADED },
        },
        select: { truckLoad: { select: { plate: true } } },
      });
      if (stillOnSite.length)
        throw new BadRequestException(
          `Camion(s) encore sur site : ${[...new Set(stillOnSite.map((l) => l.truckLoad.plate))].join(', ')} — enregistrez leur sortie dans « Chargements camions ».`,
        );
    }

    if (kind === 'gateout' && data?.gateOut) {
      extraWrites.push(
        this.prisma.operationLine.updateMany({
          where: { id: { in: scopeIds } },
          data: {
            gateOutDriver: data.gateOut.driver,
            gateOutDestination: data.gateOut.destination,
            gateOutAt: performedAt,
            ...(data.gateOut.plate && {
              pickupTruckPlate: data.gateOut.plate,
            }),
            ...(data.gateOut.carrier && {
              pickupTruckCarrier: data.gateOut.carrier,
            }),
            ...(data.gateOut.cin && {
              pickupDriverCin: data.gateOut.cin,
            }),
            ...(data.gateOut.permit && {
              pickupPermitNo: data.gateOut.permit,
            }),
            pickupDriverName: data.gateOut.driver,
          },
        }),
      );
    }

    if (kind === 'emptyreturn') {
      const containerIds = scope
        .map((l) => l.yardContainerId)
        .filter((id): id is string => !!id);
      if (!containerIds.length)
        throw new BadRequestException(
          'Aucun conteneur à retourner dans cette étape.',
        );
      // Conteneur déjà sorti (Gate OUT du parc) : sa vraie date de sortie et
      // son camion sont conservés, l'étape est simplement validée.
      const containers = await this.prisma.yardContainer.findMany({
        where: {
          id: { in: containerIds },
          tenantId,
          status: { not: YardContainerStatus.DEPARTED },
        },
        select: {
          id: true,
          yardPositionId: true,
          yardPosition: {
            select: {
              yardId: true,
              block: true,
              bay: true,
              row: true,
              tier: true,
            },
          },
        },
      });
      const gateOut = data?.gateOut;
      for (const container of containers) {
        extraWrites.push(
          this.prisma.yardContainer.update({
            where: { id: container.id },
            data: {
              status: YardContainerStatus.DEPARTED,
              containerType: 'EMPTY',
              isBeingDevanned: false,
              gateOutDate: performedAt,
              yardPositionId: null,
              ...(gateOut?.driver ? { driverName: gateOut.driver } : {}),
              ...(gateOut?.plate ? { truckPlate: gateOut.plate } : {}),
              ...(gateOut?.carrier ? { gateOutCarrier: gateOut.carrier } : {}),
              ...(gateOut?.cin ? { gateOutDriverCin: gateOut.cin } : {}),
              ...(gateOut?.permit ? { gateOutPermitNo: gateOut.permit } : {}),
              ...(gateOut?.destination
                ? { destination: gateOut.destination }
                : {}),
            },
          }),
        );
        if (container.yardPositionId && container.yardPosition) {
          extraWrites.push(
            this.prisma.yardPosition.update({
              where: { id: container.yardPositionId },
              data: { isOccupied: false },
            }),
          );
          freedPositions.push(container.yardPosition);
        }
      }
    }

    if (kind === 'seal') {
      if (!data?.seals?.length)
        throw new BadRequestException(
          'Le relevé de plomb est requis pour chaque conteneur du périmètre.',
        );
      const missing = scopeIds.filter(
        (id) => !data.seals!.some((s) => s.operationLineId === id),
      );
      if (missing.length)
        throw new BadRequestException(
          `Relevé de plomb manquant pour ${missing.length} conteneur(s) du périmètre.`,
        );
      for (const s of data.seals) {
        if (!scopeIds.includes(s.operationLineId)) continue;
        extraWrites.push(
          this.prisma.operationLine.update({
            where: { id: s.operationLineId },
            data: {
              sealRead: s.sealRead,
              sealState: s.state,
              sealWitness: s.witness,
              sealCheckedAt: performedAt,
            },
          }),
        );
      }
    }

    if (kind === 'sealing') {
      if (!data?.newSeal)
        throw new BadRequestException(
          'Le n° du scellé neuf est requis pour cette étape.',
        );
      const containerIds = scope
        .map((l) => l.yardContainerId)
        .filter((id): id is string => !!id);
      if (!containerIds.length)
        throw new BadRequestException(
          'Aucun conteneur à sceller dans le périmètre de cette étape.',
        );
      extraWrites.push(
        this.prisma.yardContainer.updateMany({
          where: { id: { in: containerIds } },
          data: { sealNumber: data.newSeal },
        }),
      );
    }

    if (kind === 'reserve') {
      if (!data?.emptyContainer)
        throw new BadRequestException(
          'Les informations du conteneur vide réservé sont requises.',
        );
      const yardId = op.shipmentFile.defaultYardId;
      if (!yardId)
        throw new BadRequestException(
          "Ce dossier n'a pas de yard cible — voir Paramétrage DOS.",
        );
      // Créé hors du tableau $transaction([...]) ci-dessous (form array,
      // dont chaque étape doit être une PrismaPromise déjà construite avant
      // exécution — impossible d'y référencer un id généré par une étape
      // précédente du MÊME tableau) : le conteneur doit exister pour que
      // l'OperationLine[OUTPUT] qui le référence puisse être ajoutée à
      // extraWrites. Statut IN_YARD sans position (yardPositionId null) —
      // ce conteneur vide est au poste d'empotage, pas stocké dans le parc.
      const container = await this.prisma.yardContainer.create({
        data: {
          tenantId,
          yardId,
          containerNumber: data.emptyContainer.containerNumber.toUpperCase(),
          isoTypeCode: data.emptyContainer.isoTypeCode.toUpperCase(),
          sizeFt: sizeForType(data.emptyContainer.isoTypeCode, data.emptyContainer.sizeFt),
          containerType: data.emptyContainer.containerType ?? 'DRY',
          isDangerousGoods: data.emptyContainer.isDangerousGoods ?? false,
          status: 'IN_YARD',
          gateInDate: performedAt,
        },
      });
      extraWrites.push(
        this.prisma.operationLine.create({
          data: {
            operationId,
            yardContainerId: container.id,
            role: OperationLineRole.OUTPUT,
          },
        }),
      );
    }

    // storageDaysForInvoice/storageFreetimeForInvoice : capturés ici pour
    // être réutilisés APRÈS la transaction (bloc d'émission de facture
    // ci-dessous, kind==='gateout') — resolve() attend un nombre de jours
    // TOTAL (pas encore réduit par la franchise, voir ResolveInducedServicesDto),
    // exactement la valeur `days` calculée ici.
    //
    // Le séjour n'est PAS forcément porté par l'opération qu'on avance ici
    // (ex: ICD_OUT, la sortie) — c'est l'opération d'ENTRÉE du dossier
    // (ex: ICD_FULL) qui a démarré storageBillingStartedAt au placement.
    // Chercher au niveau du dossier (shipmentFileId), pas seulement sur
    // `op`, sinon ce bloc ne se déclenche jamais dès qu'entrée et sortie
    // sont deux Operation distinctes — confirmé par vérification en
    // conditions réelles (voir décision explicite, moteur de séjour).
    let storageDaysForInvoice: number | null = null;
    let storageFreetimeForInvoice = 0;
    let closedStorageOpId: string | null = null;
    if (kind === 'gateout') {
      const storageOp =
        op.storageBillingStartedAt && !op.storageBillingEndedAt
          ? op
          : await this.prisma.operation.findFirst({
              where: {
                shipmentFileId: op.shipmentFile.id,
                tenantId,
                storageBillingStartedAt: { not: null },
                storageBillingEndedAt: null,
              },
              select: {
                id: true,
                storageBillingStartedAt: true,
                storageFreetimeDays: true,
              },
              orderBy: { storageBillingStartedAt: 'asc' },
            });
      if (storageOp?.storageBillingStartedAt) {
        const start = storageOp.storageBillingStartedAt;
        const end = performedAt; // fin du séjour = date réelle de sortie
        const days = await this.countTenantStayDays(tenantId, start, end);
        const freetimeDays = storageOp.storageFreetimeDays ?? 0;
        const billable = stayBillableDays(days, freetimeDays);
        storageDaysForInvoice = days;
        storageFreetimeForInvoice = freetimeDays;
        closedStorageOpId = storageOp.id;
        extraWrites.push(
          this.prisma.operation.update({
            where: { id: storageOp.id },
            data: {
              storageBillingEndedAt: end,
              storageBillableDays: billable,
            },
          }),
        );
      }
    }

    if (data?.loadplan?.length) {
      for (const truck of data.loadplan) {
        const unitIds = truck.units.filter((id) => scopeIds.includes(id));
        if (!unitIds.length) continue;
        const isPickup = truck.pickup === true || kind === 'transship';
        extraWrites.push(
          this.prisma.operationLine.updateMany({
            where: { id: { in: unitIds } },
            data: isPickup
              ? {
                  pickupTruckPlate: truck.plate,
                  pickupTruckCarrier: truck.carrier,
                  pickupDriverName: truck.driver,
                  pickupDriverCin: truck.cin,
                  pickupPermitNo: truck.permit,
                  pickupLoadedAt: performedAt,
                }
              : {
                  truckPlate: truck.plate,
                  truckCarrier: truck.carrier,
                  truckAssignedAt: performedAt,
                },
          }),
        );
      }
    }

    // Instantané des valeurs que cette étape va écraser — rend le retour à
    // l'étape précédente (rewind()) fiable sans deviner l'état antérieur.
    const snapshotFields = [
      ...(STEP_SNAPSHOT_FIELDS[kind] ?? []),
      ...(data?.loadplan?.length ? STEP_SNAPSHOT_FIELDS.loadplan : []),
      ...STEP_SNAPSHOT_FIELDS.resources,
    ];
    const restockKinds =
      kind === 'whreception' ||
      (kind === 'placement' && op.type === OperationType.DEP_STOCK);
    const shipmentLineStatuses = restockKinds
      ? await this.prisma.shipmentLine.findMany({
          where: { shipmentFileId: op.shipmentFile.id },
          select: { id: true, status: true, yardId: true, zoneId: true },
        })
      : undefined;
    const snapshotOf = (l: (typeof scope)[number]) =>
      ({
        line: Object.fromEntries(
          snapshotFields.map((f) => [
            f,
            (l as unknown as Record<string, unknown>)[f] ?? null,
          ]),
        ),
        ...(kind === 'sealing'
          ? { prevSealNumber: l.yardContainer?.sealNumber ?? null }
          : {}),
        ...(kind === 'unload' && isDepotageOp && l.yardContainer
          ? { prevContainerType: l.yardContainer.containerType }
          : {}),
        ...(shipmentLineStatuses ? { shipmentLines: shipmentLineStatuses } : {}),
        ...(closedStorageOpId ? { closedStorageOpId } : {}),
      }) as Prisma.InputJsonValue;

    await this.prisma.$transaction([
      this.prisma.operationLine.updateMany({
        where: { id: { in: scopeIds } },
        data: { stepIdx: nextIdx, done },
      }),
      this.prisma.operationStepLog.createMany({
        data: scope.map((l) => ({
          operationLineId: l.id,
          stepIdx: at,
          stepLabel: label,
          kind,
          byId: userId,
          performedAt,
          equipmentName,
          handlingCrewType: crew?.type ?? null,
          handlingCrewCount: crewCount,
          data: snapshotOf(l),
        })),
      }),
      ...extraWrites,
    ]);

    if (stayAlertToSchedule) {
      this.alertsService
        .scheduleStayFranchiseAlert(stayAlertToSchedule)
        .catch(() => undefined);
    }
    if (kind === 'gateout') {
      this.alertsService
        .cancelStayFranchiseAlert(op.shipmentFile.id)
        .catch(() => undefined);
      const plates = new Set(
        [
          data?.gateOut?.plate,
          ...scope.map((l) => l.pickupTruckPlate ?? l.truckPlate),
        ].filter((p): p is string => !!p),
      );
      for (const plate of plates)
        await this.gateRegistry
          .checkOut(tenantId, plate)
          .catch(() => undefined);
    }

    // WebSocket (règle 6, CLAUDE.md) : notifie chaque position yard occupée
    // par ce placement — même chemin que reserveCapacity().
    if (occupiedPositions.length) {
      const yardId = op.shipmentFile.defaultYardId as string;
      for (const pos of occupiedPositions) {
        this.yardMapGateway.emitPositionUpdated(tenantId, {
          yardId,
          block: pos.block,
          bay: pos.bay,
          row: pos.row,
          tier: pos.tier,
          isOccupied: true,
          containerId: null,
        });
      }
    }
    for (const pos of freedPositions) {
      this.yardMapGateway.emitPositionUpdated(tenantId, {
        yardId: pos.yardId,
        block: pos.block,
        bay: pos.bay,
        row: pos.row,
        tier: pos.tier,
        isOccupied: false,
        containerId: null,
      });
    }

    // Émission de la facture au Gate Out si elle est encore en brouillon —
    // hors transaction principale : InvoicesService.issue() fait son propre
    // upsert et sa propre numérotation séquentielle. Avant émission, on
    // (ré)appelle le moteur de résolution des prestations induites avec les
    // VRAIES valeurs de séjour tout juste calculées ci-dessus (jours totaux
    // + franchise réelle) — sans cet appel, storageBillableDays reste écrit
    // sur Operation mais n'a jamais d'effet sur la ligne de facturation
    // séjour, qui resterait figée à l'estimation faite à la création du
    // dossier (voir décision explicite — moteur de séjour, point 4).
    //
    // Détention camion de reprise : même appel, jours = durée Chargement →
    // Sortie au-delà de 24h, même si le dossier n'a pas de magasinage yard.
    // Transbordement : les services du dossier sont portés par les camions
    // chargés et facturés quand le DERNIER d'entre eux sort — tant qu'une
    // unité n'a pas franchi « Sortie camion », la facture attend.
    const isTransship = op.type === OperationType.DEP_TRANS;
    const transshipPending =
      kind === 'gateout' && isTransship
        ? await this.prisma.operationLine.count({
            where: {
              operationId,
              done: false,
              stepIdx: { lte: at },
            },
          })
        : 0;
    if (kind === 'gateout' && !transshipPending) {
      const pickupLines = await this.prisma.operationLine.findMany({
        where: {
          id: { in: scopeIds },
          pickupLoadedAt: { not: null },
        },
        select: { pickupLoadedAt: true, gateOutAt: true },
      });
      // Transbordement : chaque camion chargé a son propre compteur
      // (chargement → gate out) — la surestarie est la somme par camion.
      const pickupWaitDays = isTransship
        ? (
            await this.prisma.truckLoad.findMany({
              where: {
                tenantId,
                status: { not: TruckLoadStatus.CANCELLED },
                lines: { some: { shipmentFileId: op.shipmentFile.id } },
              },
              select: { loadedAt: true, gateOutAt: true },
            })
          ).reduce(
            (sum, t) =>
              sum +
              pickupDetentionDays(
                pickupWaitHours(t.loadedAt, t.gateOutAt ?? new Date()),
                op.shipmentFile.client?.truckFreetimeHours,
              ),
            0,
          )
        : pickupLines.reduce((max, l) => {
            if (!l.pickupLoadedAt) return max;
            const hours = pickupWaitHours(
              l.pickupLoadedAt,
              l.gateOutAt ?? new Date(),
            );
            return Math.max(
              max,
              pickupDetentionDays(
                hours,
                op.shipmentFile.client?.truckFreetimeHours,
              ),
            );
          }, 0);

      const invoice = await this.prisma.invoice.findUnique({
        where: { shipmentFileId: op.shipmentFile.id },
        select: { status: true },
      });
      if (
        !invoice ||
        invoice.status === InvoiceStatus.DRAFT
      ) {
        if (
          storageDaysForInvoice !== null ||
          pickupLines.length > 0 ||
          pickupWaitDays > 0
        ) {
          await this.inducedServicesService.resolve(
            op.shipmentFile.id,
            tenantId,
            {
              days: storageDaysForInvoice ?? 0,
              freetime: storageFreetimeForInvoice,
              pickupWaitDays,
            },
          );
          await this.invoicesService.issue(op.shipmentFile.id, tenantId);
        }
      }
    }

    // Dépotage + stockage : une fois la marchandise placée en stock, sa
    // sortie est préparée automatiquement — opération « Sortie de
    // marchandises d'entrepôt » (ENT_OUT) rattachée aux colis en stock, qui
    // démarre à l'ordre de sortie du client (Finance / DEX ensuite). Sans
    // effet si une sortie est déjà en cours sur le dossier.
    if (kind === 'placement' && op.type === OperationType.DEP_STOCK) {
      await this.create(op.shipmentFile.id, tenantId, {
        type: OperationType.ENT_OUT,
      } as CreateOperationDto).catch(() => undefined);
      // Placements successifs (plusieurs conteneurs) : les colis mis en stock
      // ensuite rejoignent la sortie déjà créée.
      const exit = await this.prisma.operation.findFirst({
        where: {
          shipmentFileId: op.shipmentFile.id,
          tenantId,
          type: OperationType.ENT_OUT,
          status: { notIn: [OperationStatus.SORTI, OperationStatus.DOSSIER_CLOS] },
        },
        select: { id: true, lines: { select: { shipmentLineId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (exit) {
        const linked = new Set(exit.lines.map((l) => l.shipmentLineId));
        const inStock = await this.prisma.shipmentLine.findMany({
          where: {
            shipmentFileId: op.shipmentFile.id,
            status: ShipmentLineStatus.IN_STOCK,
          },
          select: { id: true },
        });
        const missing = inStock.filter((l) => !linked.has(l.id));
        if (missing.length)
          await this.prisma.operationLine.createMany({
            data: missing.map((l) => ({
              operationId: exit.id,
              shipmentLineId: l.id,
              role: OperationLineRole.INPUT,
            })),
          });
      }
    }

    // Transbordement : le porteur est reparti avec son conteneur vide dès la
    // fin du dépotage (sortie porteur) — l'étape « Retour conteneur vide »
    // est alors déjà réalisée et se valide d'elle-même.
    if (kind === 'gateout' && isTransship)
      await this.completeEmptyReturns(operationId, scopeIds, userId);
    // Rapport fait alors que les camions chargés sont déjà sortis : la
    // sortie camion s'enregistre d'elle-même avec leur vraie date.
    if (kind === 'report' && isTransship)
      await this.autoTruckExit(operationId, scopeIds, tenantId, userId, userRole);

    // L'opération elle-même est terminée quand toutes ses lignes le sont —
    // EN_STOCK pour une opération entrante, SORTI pour une sortante.
    const remaining = await this.prisma.operationLine.count({
      where: { operationId, done: false },
    });
    if (remaining === 0 && op.status !== OperationStatus.DOSSIER_CLOS) {
      // Dépotage avec transbordement : la marchandise repart en camion et le
      // conteneur vide est rendu — rien ne reste en stock → SORTI (et non
      // EN_STOCK, qui laissait TIDI2601 « en stock » après ses 6 sorties).
      const allGone = cfg.dir === 'OUT' || op.type === OperationType.DEP_TRANS;
      await this.prisma.operation.update({
        where: { id: operationId },
        data: {
          status: allGone ? OperationStatus.SORTI : OperationStatus.EN_STOCK,
        },
      });
      await this.syncFileCompletion(op.shipmentFile.id);
    }

    const gap =
      TALLY_KINDS.includes(kind) && data?.tally?.length
        ? data.tally.reduce((sum, t) => {
            const line = scope.find((l) => l.id === t.operationLineId);
            const expected =
              line?.expectedQuantity ?? line?.shipmentLine?.quantity ?? 0;
            return sum + (t.counted - expected);
          }, 0)
        : kind === 'report' && data?.reports?.length
          ? data.reports.reduce((sum, r) => {
              const line = scope.find((l) => l.id === r.operationLineId);
              const expected =
                line?.expectedQuantity ?? line?.shipmentLine?.quantity ?? 0;
              return sum + (r.received - expected);
            }, 0)
          : undefined;

    return { scope: scope.length, stepIdx: nextIdx, done, label, gap };
  }

  /**
   * Retour à l'étape précédente — corrige une erreur de saisie ou de
   * traitement sans reprendre tout le dossier. Les unités repassent à
   * l'étape qu'elles viennent de franchir ; les valeurs écrasées par cette
   * étape sont restaurées depuis l'instantané du journal (OperationStepLog
   * .data, écrit par advance()). Réservé aux profils DEX/ADMIN, motif
   * obligatoire. Refusé quand l'effet de l'étape ne se défait pas (facture
   * émise, conteneur sorti du site, conteneur vide créé).
   */
  async rewind(
    operationId: string,
    tenantId: string,
    userId: string,
    userRole: UserRole,
    dto: RewindOperationDto,
  ) {
    const allowed =
      DEX_ROLES.includes(userRole) ||
      (await this.access.hasAny(userId, userRole, [
        'dossiers.validate.dex',
        'workflow.dex.validate',
      ]));
    if (!allowed)
      throw new ForbiddenException(
        "Seuls les profils DEX ou administrateur peuvent revenir à l'étape précédente.",
      );
    const reason = dto.reason?.trim();
    if (!reason)
      throw new BadRequestException('Le motif du retour arrière est requis.');

    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, tenantId },
      include: {
        shipmentFile: {
          select: { id: true, invoice: { select: { status: true } } },
        },
        lines: {
          include: {
            yardContainer: { select: { id: true, status: true } },
            stepLogs: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!op) throw new NotFoundException('Opération introuvable.');
    const cfg = OPERATION_TYPE_CFG[op.type];

    const scope = op.lines
      .filter((l) => l.stepIdx > 0)
      .filter(
        (l) => !dto.operationLineIds || dto.operationLineIds.includes(l.id),
      );
    if (!scope.length)
      throw new BadRequestException(
        "Aucune unité n'a encore franchi d'étape dans cette opération.",
      );
    const idxs = [...new Set(scope.map((l) => l.stepIdx))];
    if (idxs.length > 1)
      throw new BadRequestException(
        'Les unités sélectionnées ne sont pas à la même étape — traitez-les séparément.',
      );
    const target = idxs[0] - 1;
    const label = cfg.steps[target] ?? `Étape ${target + 1}`;

    // Dernier franchissement RÉEL de l'étape cible pour chaque unité (un
    // éventuel retour arrière antérieur n'est pas un franchissement).
    const lastPass = new Map(
      scope.map((l) => [
        l.id,
        l.stepLogs.find((g) => g.stepIdx === target && g.kind !== 'rewind'),
      ]),
    );
    const kinds = [
      ...new Set([...lastPass.values()].map((g) => g?.kind ?? 'confirm')),
    ];
    for (const k of kinds) {
      if (NON_REWINDABLE_KINDS[k])
        throw new BadRequestException(
          `Retour impossible sur « ${label} » : ${NON_REWINDABLE_KINDS[k]}.`,
        );
    }
    if (kinds.includes('gateout')) {
      const invoiceStatus = op.shipmentFile.invoice?.status;
      if (invoiceStatus && invoiceStatus !== InvoiceStatus.DRAFT)
        throw new BadRequestException(
          `Retour impossible sur « ${label} » : la facture du dossier est déjà émise.`,
        );
      if (scope.some((l) => l.yardContainer?.status === YardContainerStatus.DEPARTED))
        throw new BadRequestException(
          `Retour impossible sur « ${label} » : le conteneur est déjà sorti du site.`,
        );
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const restoredShipmentLines = new Set<string>();
    for (const l of scope) {
      const snap = (lastPass.get(l.id)?.data ?? null) as {
        line?: Record<string, unknown>;
        prevSealNumber?: string | null;
        prevContainerType?: ContainerType;
        shipmentLines?: Array<{
          id: string;
          status: ShipmentLineStatus;
          yardId: string | null;
          zoneId: string | null;
        }>;
        closedStorageOpId?: string;
      } | null;
      const restore: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(snap?.line ?? {})) {
        if (field === 'slot')
          restore.slot = value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
        else if (SNAPSHOT_DATE_FIELDS.has(field))
          restore[field] = value ? new Date(value as string) : null;
        else restore[field] = value;
      }
      writes.push(
        this.prisma.operationLine.update({
          where: { id: l.id },
          data: { ...restore, stepIdx: target, done: false },
        }),
      );
      if (snap?.prevContainerType && l.yardContainerId)
        writes.push(
          this.prisma.yardContainer.update({
            where: { id: l.yardContainerId },
            data: { containerType: snap.prevContainerType },
          }),
        );
      if (snap && 'prevSealNumber' in snap && l.yardContainerId)
        writes.push(
          this.prisma.yardContainer.update({
            where: { id: l.yardContainerId },
            data: { sealNumber: snap.prevSealNumber ?? null },
          }),
        );
      for (const sl of snap?.shipmentLines ?? []) {
        if (restoredShipmentLines.has(sl.id)) continue;
        restoredShipmentLines.add(sl.id);
        writes.push(
          this.prisma.shipmentLine.updateMany({
            where: { id: sl.id, status: { not: ShipmentLineStatus.OUT } },
            data: { status: sl.status, yardId: sl.yardId, zoneId: sl.zoneId },
          }),
        );
      }
      if (snap?.closedStorageOpId)
        writes.push(
          this.prisma.operation.updateMany({
            where: { id: snap.closedStorageOpId, tenantId },
            data: { storageBillingEndedAt: null, storageBillableDays: null },
          }),
        );
    }
    writes.push(
      this.prisma.operationStepLog.createMany({
        data: scope.map((l) => ({
          operationLineId: l.id,
          stepIdx: target,
          stepLabel: label,
          kind: 'rewind',
          byId: userId,
          reason,
        })),
      }),
    );
    // Une opération terminée redevient en cours d'exécution.
    if (
      op.status === OperationStatus.EN_STOCK ||
      op.status === OperationStatus.SORTI
    )
      writes.push(
        this.prisma.operation.update({
          where: { id: operationId },
          data: { status: OperationStatus.EN_OPERATION },
        }),
      );
    await this.prisma.$transaction(writes);

    return { scope: scope.length, stepIdx: target, label };
  }

  /**
   * Files réelles des postes d'exécution. Les unités non actionnables ne sont
   * pas masquées : elles remontent avec le motif de blocage (`readiness`) pour
   * que le poste affiche ce qui reste à débloquer plutôt qu'un écran vide.
   */
  async getExecutionQueue(tenantId: string, direction?: 'IN' | 'OUT') {
    const operations = await this.prisma.operation.findMany({
      where: {
        tenantId,
        status: {
          notIn: [OperationStatus.SORTI, OperationStatus.DOSSIER_CLOS],
        },
        lines: { some: { done: false } },
      },
      select: {
        id: true,
        type: true,
        status: true,
        shipmentFileId: true,
        shipmentFile: {
          select: {
            voyageCode: true,
            client: { select: { id: true, name: true } },
          },
        },
        lines: {
          where: { done: false },
          select: {
            id: true,
            stepIdx: true,
            yardContainerId: true,
            shipmentLineId: true,
            yardContainer: {
              select: { id: true, containerNumber: true, status: true },
            },
            shipmentLine: {
              select: { id: true, packageRef: true, status: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const readinessOf = (
      line: (typeof operations)[number]['lines'][number],
      opType: OperationType,
    ) => {
      const container = line.yardContainer;
      // Dépotage : le conteneur (vidé, ou sorti trop tôt par le Gate OUT du
      // parc) peut avoir quitté le site alors que les étapes de la
      // marchandise restent à faire (rapport, sortie camion…) — elles ne
      // doivent pas rester bloquées.
      if (
        container?.status === YardContainerStatus.DEPARTED &&
        (opType === OperationType.DEP_TRANS || opType === OperationType.DEP_STOCK)
      )
        return { ready: true, readiness: 'READY' as const };
      if (container) {
        switch (container.status) {
          case YardContainerStatus.IN_YARD:
          case YardContainerStatus.GATE_OUT_PROGRESS:
            return { ready: true, readiness: 'READY' as const };
          case YardContainerStatus.POSITIONING:
            return { ready: false, readiness: 'AWAITING_POSITION' as const };
          case YardContainerStatus.GATE_IN_PROGRESS:
            return { ready: false, readiness: 'AWAITING_GATE_IN' as const };
          case YardContainerStatus.ON_HOLD:
            return { ready: false, readiness: 'ON_HOLD' as const };
          default:
            return { ready: false, readiness: 'DEPARTED' as const };
        }
      }
      if (!line.shipmentLine)
        return { ready: false, readiness: 'NO_CARGO' as const };
      if (line.shipmentLine.status === ShipmentLineStatus.PENDING)
        return { ready: false, readiness: 'AWAITING_RECEPTION' as const };
      if (line.shipmentLine.status === ShipmentLineStatus.OUT)
        return { ready: false, readiness: 'DEPARTED' as const };
      return { ready: true, readiness: 'READY' as const };
    };

    return operations.flatMap((operation) => {
      const cfg = OPERATION_TYPE_CFG[operation.type];
      if (direction && cfg.dir !== direction) return [];
      const units = operation.lines.map((line) => {
        const { ready, readiness } = readinessOf(line, operation.type);
        return {
          operationLineId: line.id,
          // Identifiant de l'unité de cargaison (conteneur ou colis) — c'est
          // celui que les écrans utilisent pour cibler une unité, distinct de
          // l'id OperationLine consommé par les appels d'avancement.
          unitId:
            line.yardContainer?.id ?? line.shipmentLine?.id ?? line.id,
          label:
            line.yardContainer?.containerNumber ??
            line.shipmentLine?.packageRef ??
            line.id,
          stepIdx: line.stepIdx,
          step: cfg.steps[line.stepIdx] ?? 'Terminé',
          containerStatus: line.yardContainer?.status ?? null,
          cargoStatus: line.shipmentLine?.status ?? null,
          ready,
          readiness,
        };
      });
      if (!units.length) return [];
      const readyUnits = units.filter((unit) => unit.ready);
      const awaitingValidation =
        operation.status === OperationStatus.TO_VALIDATE ||
        operation.status === OperationStatus.REJECTED;
      return [
        {
          operationId: operation.id,
          shipmentFileId: operation.shipmentFileId,
          dossier: operation.shipmentFile.voyageCode,
          clientId: operation.shipmentFile.client?.id ?? null,
          client: operation.shipmentFile.client?.name ?? '—',
          type: operation.type,
          direction: cfg.dir,
          status: operation.status,
          steps: cfg.steps,
          awaitingValidation,
          actionable: !awaitingValidation && readyUnits.length > 0,
          pendingUnits: units.length,
          readyUnits: readyUnits.length,
          stepIndexes: [...new Set(units.map((unit) => unit.stepIdx))],
          units,
        },
      ];
    });
  }

  /** Agrégats réels des tableaux de bord Opérations et Direction. */
  async getDashboard(tenantId: string) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const sinceDays = (days: number) => {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - days + 1);
      return d;
    };
    const since7 = sinceDays(7);
    const since30 = sinceDays(30);

    const [
      files,
      operations,
      gatePasses,
      exits,
      yardMovements,
      stockLines,
      invoices,
      payments,
      unreadAlerts,
      positionCounts,
    ] = await Promise.all([
      this.prisma.shipmentFile.findMany({
        where: { tenantId },
        select: {
          id: true,
          voyageCode: true,
          status: true,
          createdAt: true,
          sommierExpiryDate: true,
          blockedAt: true,
          client: { select: { id: true, name: true } },
        },
      }),
      this.prisma.operation.findMany({
        where: { tenantId },
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          closedAt: true,
          shipmentFile: {
            select: {
              id: true,
              voyageCode: true,
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.gatePass.findMany({
        where: { operation: { tenantId }, gateInDate: { gte: since7 } },
        select: { gateInDate: true },
      }),
      this.prisma.exitMovement.findMany({
        where: { tenantId, gateOutAt: { gte: since7 } },
        select: { gateOutAt: true },
      }),
      this.prisma.yardMovement.findMany({
        where: {
          container: { tenantId },
          createdAt: { gte: since7 },
          movementType: { in: ['GATE_IN', 'GATE_OUT'] },
        },
        select: { movementType: true, createdAt: true },
      }),
      this.prisma.shipmentLine.findMany({
        where: {
          tenantId,
          status: { in: ['IN_STOCK', 'RESERVED', 'PARTIAL_OUT'] },
        },
        select: {
          packageCount: true,
          quantity: true,
          quantityOut: true,
          weightKg: true,
          volumeM3: true,
          surfaceM2: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: { tenantId },
        select: {
          status: true,
          total: true,
          issuedAt: true,
          paidAt: true,
          shipmentFile: {
            select: { client: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PENDING },
        select: { dueDate: true },
      }),
      this.prisma.alert.count({ where: { tenantId, readAt: null } }),
      this.prisma.yardPosition.groupBy({
        by: ['isOccupied'],
        where: { yard: { tenantId } },
        _count: { _all: true },
      }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(since7);
      d.setDate(d.getDate() + i);
      return {
        date: dayKey(d),
        label: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d),
        entries: 0,
        exits: 0,
        completed: 0,
      };
    });
    const byDay = new Map(days.map((d) => [d.date, d]));
    for (const p of gatePasses) byDay.get(dayKey(p.gateInDate))!.entries += 1;
    for (const m of yardMovements) {
      const d = byDay.get(dayKey(m.createdAt));
      if (!d) continue;
      if (m.movementType === 'GATE_IN') d.entries += 1;
      if (m.movementType === 'GATE_OUT') d.exits += 1;
    }
    for (const e of exits) {
      const d = e.gateOutAt && byDay.get(dayKey(e.gateOutAt));
      if (d) d.exits += 1;
    }
    for (const o of operations) {
      const d = o.closedAt && byDay.get(dayKey(o.closedAt));
      if (d) d.completed += 1;
    }

    const closedStatuses = new Set<OperationStatus>([
      OperationStatus.SORTI,
      OperationStatus.DOSSIER_CLOS,
    ]);
    const activeFiles = files.filter((f) => f.status !== ShipmentFileStatus.FULLY_OUT);
    const activeOperations = operations.filter((o) => !closedStatuses.has(o.status));
    const typeCounts: Record<string, number> = {};
    for (const o of activeOperations)
      typeCounts[o.type] = (typeCounts[o.type] ?? 0) + 1;

    const totalSlots = positionCounts.reduce((s, r) => s + r._count._all, 0);
    const usedSlots = positionCounts
      .filter((r) => r.isOccupied)
      .reduce((s, r) => s + r._count._all, 0);
    const stock = stockLines.reduce(
      (a, l) => ({
        packages:
          a.packages +
          Math.max(0, (l.packageCount ?? l.quantity) - l.quantityOut),
        weightKg: a.weightKg + (l.weightKg ?? 0),
        volumeM3: a.volumeM3 + (l.volumeM3 ?? 0),
        surfaceM2: a.surfaceM2 + (l.surfaceM2 ?? 0),
      }),
      { packages: 0, weightKg: 0, volumeM3: 0, surfaceM2: 0 },
    );

    const soon = new Date(now);
    soon.setDate(soon.getDate() + 30);
    const sommier = { ok: 0, soon: 0, expired: 0 };
    for (const f of activeFiles) {
      if (!f.sommierExpiryDate) continue;
      if (f.sommierExpiryDate < now) sommier.expired += 1;
      else if (f.sommierExpiryDate <= soon) sommier.soon += 1;
      else sommier.ok += 1;
    }

    const monthBuckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(d),
        revenue: 0,
      };
    });
    const revenueByMonth = new Map(monthBuckets.map((m) => [m.key, m]));
    const clientRevenue = new Map<string, { client: string; revenue: number }>();
    for (const inv of invoices) {
      if (!inv.issuedAt || inv.status === InvoiceStatus.DRAFT) continue;
      const key = inv.issuedAt.toISOString().slice(0, 7);
      const total = inv.total ?? 0;
      const bucket = revenueByMonth.get(key);
      if (bucket) bucket.revenue += total;
      const client = inv.shipmentFile.client;
      const clientKey = client?.id ?? 'unknown';
      const item = clientRevenue.get(clientKey) ?? {
        client: client?.name ?? 'Non identifié',
        revenue: 0,
      };
      item.revenue += total;
      clientRevenue.set(clientKey, item);
    }
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
    const currentRevenue = revenueByMonth.get(currentKey)?.revenue ?? 0;
    const previousRevenue = revenueByMonth.get(previousKey)?.revenue ?? 0;
    const revenueChangePct =
      previousRevenue > 0
        ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
        : null;

    const recentClosed = operations.filter(
      (o) => o.closedAt && o.closedAt >= since30,
    );
    const avgCycleHours = recentClosed.length
      ? Math.round(
          (recentClosed.reduce(
            (s, o) => s + (o.closedAt!.getTime() - o.createdAt.getTime()),
            0,
          ) /
            recentClosed.length /
            3600000) *
            10,
        ) / 10
      : 0;
    const created30 = operations.filter((o) => o.createdAt >= since30);
    const completionRate = created30.length
      ? Math.round(
          (created30.filter((o) => closedStatuses.has(o.status)).length /
            created30.length) *
            100,
        )
      : 0;

    return {
      operations: {
        activeDossiers: activeFiles.length,
        toValidate: operations.filter(
          (o) => o.status === OperationStatus.TO_VALIDATE,
        ).length,
        entriesToday: days[days.length - 1]?.entries ?? 0,
        exitsToday: days[days.length - 1]?.exits ?? 0,
        occupancyPct: totalSlots
          ? Math.round((usedSlots / totalSlots) * 100)
          : 0,
        usedSlots,
        totalSlots,
        alertsCritical: unreadAlerts + sommier.expired,
        stock,
        sommier,
        dailyFlow: days,
        byType: Object.entries(typeCounts)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
        recent: operations.slice(0, 6).map((o) => ({
          id: o.id,
          dossierId: o.shipmentFile.id,
          dossier: o.shipmentFile.voyageCode,
          client: o.shipmentFile.client?.name ?? 'Non identifié',
          type: o.type,
          status: o.status,
          createdAt: o.createdAt,
        })),
        criticalDossiers: files
          .filter(
            (f) =>
              f.blockedAt ||
              (f.sommierExpiryDate && f.sommierExpiryDate <= soon),
          )
          .sort(
            (a, b) =>
              (a.sommierExpiryDate?.getTime() ?? 0) -
              (b.sommierExpiryDate?.getTime() ?? 0),
          )
          .slice(0, 6)
          .map((f) => ({
            id: f.id,
            dossier: f.voyageCode,
            client: f.client?.name ?? 'Non identifié',
            blocked: !!f.blockedAt,
            sommierExpiryDate: f.sommierExpiryDate,
          })),
      },
      direction: {
        currentRevenue,
        previousRevenue,
        revenueChangePct,
        outstandingAmount: invoices
          .filter((i) => i.status === InvoiceStatus.ISSUED)
          .reduce((s, i) => s + (i.total ?? 0), 0),
        overduePayments: payments.filter(
          (p) => p.dueDate && p.dueDate < now,
        ).length,
        avgCycleHours,
        completionRate,
        activeDossiers: activeFiles.length,
        occupancyPct: totalSlots
          ? Math.round((usedSlots / totalSlots) * 100)
          : 0,
        monthlyRevenue: monthBuckets,
        topClients: [...clientRevenue.values()]
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5),
        operationMix: Object.entries(
          operations
            .filter((o) => o.createdAt >= since30)
            .reduce<Record<string, number>>((a, o) => {
              a[o.type] = (a[o.type] ?? 0) + 1;
              return a;
            }, {}),
        )
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
      },
    };
  }

  /** Camions de reprise encore sur site (chargés, pas sortis) + KPI d'attente. */
  async listPickupWaiting(tenantId: string) {
    const now = new Date();
    const waiting = await this.prisma.operationLine.findMany({
      where: {
        pickupLoadedAt: { not: null },
        gateOutAt: null,
        operation: { tenantId },
      },
      include: {
        operation: {
          select: {
            id: true,
            type: true,
            shipmentFile: {
              select: {
                id: true,
                voyageCode: true,
                client: {
                  select: { id: true, name: true, truckFreetimeHours: true },
                },
              },
            },
          },
        },
        yardContainer: {
          select: { containerNumber: true, sizeFt: true },
        },
      },
      orderBy: { pickupLoadedAt: 'asc' },
    });

    const seen = new Set<string>();
    const trucks = [];
    for (const l of waiting) {
      const plate = (l.pickupTruckPlate || '').toUpperCase();
      const key = `${l.operationId}:${plate}`;
      if (!plate || seen.has(key)) continue;
      seen.add(key);
      const hours = pickupWaitHours(l.pickupLoadedAt!, now);
      const band = pickupWaitBand(hours);
      trucks.push({
        operationId: l.operationId,
        operationType: l.operation.type,
        fileId: l.operation.shipmentFile.id,
        dossier: l.operation.shipmentFile.voyageCode,
        client: l.operation.shipmentFile.client?.name ?? null,
        container: l.yardContainer?.containerNumber ?? null,
        plate,
        carrier: l.pickupTruckCarrier || 'TIERS',
        driver: l.pickupDriverName,
        cin: l.pickupDriverCin,
        permit: l.pickupPermitNo,
        loadedAt: l.pickupLoadedAt,
        hours: Math.round(hours * 10) / 10,
        band,
        status: 'En attente douane',
        detentionDays: pickupDetentionDays(
          hours,
          l.operation.shipmentFile.client?.truckFreetimeHours,
        ),
      });
    }

    const since = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return d;
    };
    const closed = await this.prisma.operationLine.findMany({
      where: {
        pickupLoadedAt: { not: null },
        gateOutAt: { not: null, gte: since(30) },
        operation: { tenantId },
      },
      select: {
        operationId: true,
        pickupLoadedAt: true,
        gateOutAt: true,
        pickupTruckPlate: true,
      },
    });
    const avgFor = (days: number) => {
      const from = since(days);
      const rows = closed.filter((l) => l.gateOutAt && l.gateOutAt >= from);
      if (!rows.length) return 0;
      const sum = rows.reduce(
        (a, l) => a + pickupWaitHours(l.pickupLoadedAt!, l.gateOutAt!),
        0,
      );
      return Math.round((sum / rows.length) * 10) / 10;
    };

    const byBand = { ok: 0, warn: 0, alert: 0 };
    const byCarrier: Record<string, number> = {};
    let detentionEstimate = 0;
    for (const t of trucks) {
      byBand[t.band] += 1;
      const c = t.carrier || 'TIERS';
      byCarrier[c] = (byCarrier[c] || 0) + 1;
      detentionEstimate += t.detentionDays * 20000;
    }

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const gateEntriesToday = await this.prisma.gatePass.count({
      where: { operation: { tenantId }, gateInDate: { gte: startOfToday } },
    });
    const seenClosedToday = new Set(
      closed
        .filter((l) => l.gateOutAt && l.gateOutAt >= startOfToday)
        .map(
          (l) =>
            `${l.operationId}:${(l.pickupTruckPlate || '').toUpperCase()}`,
        ),
    );
    const trendStart = since(6);
    trendStart.setHours(0, 0, 0, 0);
    const trend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(trendStart);
      d.setDate(d.getDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        label: new Intl.DateTimeFormat('fr-FR', {
          weekday: 'short',
        }).format(d),
        loaded: 0,
      };
    });
    const trendMap = new Map(trend.map((d) => [d.date, d]));
    const loadedSeen = new Set<string>();
    for (const l of [...waiting, ...closed]) {
      if (!l.pickupLoadedAt || l.pickupLoadedAt < trendStart) continue;
      const key = `${l.operationId}:${(l.pickupTruckPlate || '').toUpperCase()}`;
      if (loadedSeen.has(key)) continue;
      loadedSeen.add(key);
      const bucket = trendMap.get(l.pickupLoadedAt.toISOString().slice(0, 10));
      if (bucket) bucket.loaded += 1;
    }

    return {
      thresholds: {
        warnHours: PICKUP_WAIT_WARN_HOURS,
        alertHours: PICKUP_WAIT_ALERT_HOURS,
        freeHours: PICKUP_DETENTION_FREE_HOURS,
      },
      waiting: trucks,
      stats: {
        count: trucks.length,
        avgCurrentWaitHours: trucks.length
          ? Math.round(
              (trucks.reduce((sum, truck) => sum + truck.hours, 0) /
                trucks.length) *
                10,
            ) / 10
          : 0,
        avgWaitHours7d: avgFor(7),
        avgWaitHours30d: avgFor(30),
        byBand,
        detentionEstimateFcfa: detentionEstimate,
        gateEntriesToday,
        pickupExitsToday: seenClosedToday.size,
        trend,
        byCarrier: Object.entries(byCarrier).map(([carrier, count]) => ({
          carrier,
          count,
        })),
      },
    };
  }
}
