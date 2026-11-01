import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { sizeForType } from '../common/container-iso';
import { PrismaService } from '../prisma/prisma.service';
import { YardMapGateway } from '../yard-map/yard-map.gateway';
import { PaymentsService } from '../payments/payments.service';
import { TmsService } from '../tms/tms.service';
import { GateRegistryService } from '../tms/gate-registry.service';
import { ParkService } from './park.service';
import { OPERATION_TYPE_CFG } from '../operations/operation-types';
import { OperationType, OperationStatus } from '@prisma/client';
import { countStayDays, stayBillableDays } from '../stay-engine/stay-engine';
import {
  ContainerType,
  YardContainerStatus,
  YardMovementType,
  YardBlockDef,
  Prisma,
} from '@prisma/client';
import { GateInDto } from './dto/gate-in.dto';
import { GateOutDto } from './dto/gate-out.dto';
import { RepositionDto } from './dto/reposition.dto';
import { GateInFromPreGateDto } from './dto/gate-in-from-pregate.dto';
import { GateInBulkFromPreGateDto } from './dto/gate-in-bulk-from-pregate.dto';
import { ConfirmPositionDto } from './dto/confirm-position.dto';
import { UpdateGateInDateDto } from './dto/update-gate-in-date.dto';
import { PreGateLineStatus, PreGateStatus } from '@prisma/client';

export type PrismaTx = Prisma.TransactionClient;

// Un emplacement marqué occupé sans conteneur encore sur le parc (conteneur
// supprimé, sorti, ou simple drapeau posé par une réservation) doit redevenir
// libre. Un conteneur POSITIONING ou IN_YARD continue de tenir la place.
export async function releaseAbandonedYardPositions(
  prisma: PrismaService,
  tenantId: string,
) {
  const stale = await prisma.yardPosition.findMany({
    where: {
      isOccupied: true,
      yard: { tenantId },
      containers: {
        none: { status: { not: YardContainerStatus.DEPARTED } },
      },
    },
    select: { id: true },
  });
  if (!stale.length) return 0;
  await prisma.yardPosition.updateMany({
    where: { id: { in: stale.map((position) => position.id) } },
    data: { isOccupied: false },
  });
  return stale.length;
}

// ── Règles d'allocation de position ──────────────────────────────────────────

type AllocationParams = {
  isDangerousGoods?: boolean;
  containerType?: ContainerType;
  grossWeightKg?: number | null;
  tenantId?: string;
  yardId?: string;
};

// Position réclamée par autoAllocate()/autoAllocateBatch() — champs minimaux
// nécessaires à gateInWithTx()/gateInBatch() (yardId résolu, coordonnées pour
// notifier le plan du yard via emitPositionOccupied()/emitPositionFreed()).
type ClaimedPosition = {
  id: string;
  yardId: string;
  block: string;
  bay: number;
  row: number;
  tier: number;
};

const CONTAINER_SELECT = {
  id: true,
  tenantId: true,
  clientId: true,
  client: { select: { id: true, name: true } },
  yardId: true,
  containerNumber: true,
  isoTypeCode: true,
  sizeFt: true,
  containerType: true,
  grossWeightKg: true,
  shippingLine: true,
  voyageCode: true,
  status: true,
  customsHold: true,
  isDangerousGoods: true,
  sealNumber: true,
  gateInDate: true,
  gateOutDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  yardPositionId: true,
  yardPosition: true,
  paymentId: true,
  payment: {
    select: {
      id: true,
      termType: true,
      status: true,
      dueDate: true,
      validatedAt: true,
      validatedById: true,
      notes: true,
    },
  },
  isBeingDevanned: true,
  shipmentFiles: {
    select: { id: true, voyageCode: true, status: true },
    orderBy: { createdAt: 'desc' as const },
  },
  // Dernier mouvement seulement (pas tout l'historique, contrairement à
  // getContainer()) — juste ce qu'il faut pour la colonne "Dernier
  // mouvement" du Parc conteneurs (ContainersListScreen, yms.jsx), sans
  // alourdir la liste.
  movements: {
    select: {
      id: true,
      movementType: true,
      confirmedAt: true,
      createdAt: true,
      fromPosition: {
        select: { block: true, bay: true, row: true, tier: true },
      },
      toPosition: {
        select: { block: true, bay: true, row: true, tier: true },
      },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const;

@Injectable()
export class YmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly yardMapGateway: YardMapGateway,
    private readonly paymentsService: PaymentsService,
    private readonly tmsService: TmsService,
    private readonly gateRegistry: GateRegistryService,
    private readonly park: ParkService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────────────────────

  async getDashboard(tenantId: string, yardId?: string) {
    const [containers, blockDefs, positionCounts, slotCounts] =
      await Promise.all([
        this.prisma.yardContainer.findMany({
          where: {
            tenantId,
            status: { not: YardContainerStatus.DEPARTED },
            ...(yardId ? { yardId } : {}),
          },
          select: {
            sizeFt: true,
            containerType: true,
            status: true,
            isDangerousGoods: true,
            customsHold: true,
            yardPositionId: true,
            gateInDate: true,
            id: true,
            clientId: true,
          },
        }),
        this.prisma.yardBlockDef.findMany({
          where: { tenantId, isActive: true, ...(yardId ? { yardId } : {}) },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        }),
        this.prisma.yardPosition.groupBy({
          by: ['yardBlockDefId', 'isOccupied'],
          where: {
            yardBlockDefId: { not: null },
            ...(yardId ? { yardId } : {}),
          },
          _count: { _all: true },
        }),
        // Toutes les positions du yard, y compris celles sans YardBlockDef —
        // même périmètre que getYardMap(), pour que le taux affiché sur la
        // carte KPI corresponde exactement au plan et aux barres par bloc.
        this.prisma.yardPosition.groupBy({
          by: ['isOccupied'],
          where: {
            yard: { tenantId },
            ...(yardId ? { yardId } : {}),
          },
          _count: { _all: true },
        }),
      ]);

    // Occupation par bloc, dérivée du groupBy positions
    const occByBlockDef = new Map<
      string,
      { total: number; occupied: number }
    >();
    for (const row of positionCounts) {
      const entry = occByBlockDef.get(row.yardBlockDefId as string) ?? {
        total: 0,
        occupied: 0,
      };
      entry.total += row._count._all;
      if (row.isOccupied) entry.occupied += row._count._all;
      occByBlockDef.set(row.yardBlockDefId as string, entry);
    }
    const blockOccupancy = blockDefs.map((def) => {
      const o = occByBlockDef.get(def.id) ?? { total: 0, occupied: 0 };
      return {
        block: def.code,
        label: def.label ?? def.code,
        used: o.occupied,
        total: o.total,
        pct: o.total > 0 ? Math.round((o.occupied / o.total) * 100) : 0,
      };
    });

    // Le taux d'occupation se mesure en emplacements physiques : une position
    // accueille un conteneur quelle que soit sa taille. Compter les EVP au
    // numérateur (40' = 2) face à un total d'emplacements gonflait le taux, et
    // les conteneurs seulement annoncés au gate (pas encore posés) n'occupent
    // aucun emplacement du plan.
    const slotsTotal = slotCounts.reduce((s, r) => s + r._count._all, 0);
    const slotsUsed = slotCounts
      .filter((r) => r.isOccupied)
      .reduce((s, r) => s + r._count._all, 0);

    const teuOf = (sizeFt: number) => (sizeFt >= 40 ? 2 : 1);
    // POSITIONING : yardPositionId n'est qu'une suggestion non confirmée, la
    // position reste libre sur le plan — même exclusion que getYardMap().
    const placed = containers.filter(
      (c) =>
        c.yardPositionId != null &&
        c.status !== YardContainerStatus.POSITIONING,
    );
    const teuUsed = placed.reduce((s, c) => s + teuOf(c.sizeFt), 0);
    const teuExpected = containers
      .filter((c) => c.yardPositionId == null)
      .reduce((s, c) => s + teuOf(c.sizeFt), 0);

    const byType: Record<string, number> = {};
    for (const c of containers)
      byType[c.containerType] = (byType[c.containerType] ?? 0) + 1;

    const byStatus: Record<string, number> = {};
    for (const c of containers)
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

    return {
      slotsTotal,
      slotsUsed,
      slotsFree: Math.max(0, slotsTotal - slotsUsed),
      occupancyPct: slotsTotal > 0 ? Math.round((slotsUsed / slotsTotal) * 100) : 0,
      teuUsed,
      teuExpected,
      expectedCount: containers.length - placed.length,
      dangerousCount: containers.filter((c) => c.isDangerousGoods).length,
      customsHoldCount: containers.filter((c) => c.customsHold).length,
      // Franchise réelle (dossier / contrat client), voir ParkService.
      franchiseOverrunCount: [
        ...(await this.park.franchiseOf(tenantId, containers)).values(),
      ].filter((f) => f.state === 'over').length,
      positioningCount: byStatus[YardContainerStatus.POSITIONING] ?? 0,
      byType,
      byStatus,
      blockOccupancy,
    };
  }

  // ── Conteneurs ───────────────────────────────────────────────────────────

  async listContainers(
    tenantId: string,
    params: {
      status?: YardContainerStatus;
      search?: string;
      isBeingDevanned?: boolean;
      yardId?: string;
      clientId?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const {
      status,
      search,
      isBeingDevanned,
      yardId,
      clientId,
      skip = 0,
      take = 100,
    } = params;
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(isBeingDevanned != null ? { isBeingDevanned } : {}),
      ...(yardId ? { yardId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(search
        ? {
            OR: [
              {
                containerNumber: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                shippingLine: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                isoTypeCode: { contains: search, mode: 'insensitive' as const },
              },
              // BL (stocké « BL: … » dans notes) et code voyage du dossier.
              { notes: { contains: search, mode: 'insensitive' as const } },
              {
                shipmentFiles: {
                  some: {
                    voyageCode: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.yardContainer.count({ where }),
      this.prisma.yardContainer.findMany({
        where,
        select: CONTAINER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Franchise réelle par conteneur (dossier, contrat client plein/vide).
    const franchise = await this.park.franchiseOf(tenantId, items);
    return {
      total,
      items: items.map((c) => {
        const f = franchise.get(c.id);
        return {
          ...c,
          franchise: f ? { ...f, dossier: undefined } : null,
          dossier: f?.dossier ?? null,
        };
      }),
    };
  }

  async getContainer(id: string, tenantId: string) {
    const c = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId },
      include: {
        client: { select: { id: true, name: true } },
        yardPosition: true,
        payment: {
          select: {
            id: true,
            termType: true,
            status: true,
            dueDate: true,
            validatedAt: true,
            validatedById: true,
            notes: true,
          },
        },
        shipmentFiles: {
          select: { id: true, voyageCode: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
        movements: {
          include: { fromPosition: true, toPosition: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!c) throw new NotFoundException('Conteneur introuvable.');
    return c;
  }

  // Correction de la date/heure de Gate In d'un conteneur — miroir de
  // OperationsService.updateGatePass() côté WMS (même propagation vers le
  // début de facturation du séjour, mêmes garde-fous), pour le cas d'un
  // conteneur gaté directement via YMS (pas de GatePass, potentiellement
  // quand même rattaché à une Operation via OperationLine si dépoté vers
  // un dossier WMS ensuite).
  // Correction de la date/heure réelle de sortie d'un conteneur sorti —
  // répercutée sur l'historique (mouvement GATE_OUT) et sur la fin du séjour
  // facturé tant que la facture n'est pas émise.
  async updateGateOutDate(id: string, tenantId: string, gateOutIso: string) {
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, gateInDate: true },
    });
    if (!container) throw new NotFoundException('Conteneur introuvable.');
    if (container.status !== YardContainerStatus.DEPARTED)
      throw new BadRequestException("Ce conteneur n'est pas sorti du yard.");
    const gateOutAt = new Date(gateOutIso);
    if (gateOutAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date de sortie ne peut pas être dans le futur.',
      );
    if (container.gateInDate && gateOutAt < container.gateInDate)
      throw new BadRequestException(
        "La date de sortie ne peut pas précéder la date d'entrée du conteneur.",
      );
    const issued = await this.prisma.invoice.findFirst({
      where: {
        status: { not: 'DRAFT' },
        shipmentFile: { operations: { some: { lines: { some: { yardContainerId: id } } } } },
      },
      select: { invoiceNo: true },
    });
    if (issued)
      throw new BadRequestException(
        `La facture ${issued.invoiceNo ?? ''} est déjà émise sur ce séjour — réémettez-la après correction.`,
      );
    await this.prisma.yardContainer.update({
      where: { id },
      data: { gateOutDate: gateOutAt },
    });
    const lastOut = await this.prisma.yardMovement.findFirst({
      where: { yardContainerId: id, movementType: YardMovementType.GATE_OUT },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (lastOut)
      await this.prisma.yardMovement.update({
        where: { id: lastOut.id },
        data: { confirmedAt: gateOutAt },
      });
    // Fin du séjour recalculée (rouvert puis reclos à la sortie la plus tardive).
    const links = await this.prisma.operationLine.findMany({
      where: { yardContainerId: id, operation: { tenantId } },
      select: { operationId: true },
      distinct: ['operationId'],
    });
    await this.prisma.operation.updateMany({
      where: { id: { in: links.map((l) => l.operationId) } },
      data: { storageBillingEndedAt: null, storageBillableDays: null },
    });
    await this.closeStayIfAllDeparted(tenantId, id);
    return this.getContainer(id, tenantId);
  }

  async updateGateInDate(
    id: string,
    tenantId: string,
    dto: UpdateGateInDateDto,
  ) {
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!container) throw new NotFoundException('Conteneur introuvable.');

    const gateInAt = new Date(dto.gateInAt);
    const updated = await this.prisma.yardContainer.update({
      where: { id },
      data: { gateInDate: gateInAt },
    });

    // Répercute sur le début de facturation du séjour de la/les Operation(s)
    // liées — SEULEMENT si le séjour est encore en cours (pas déjà clôturé
    // au Gate Out, où storageBillableDays a été figé pour une facture déjà
    // émise) — même règle que updateGatePass() côté WMS.
    const linkedOperationIds = await this.prisma.operationLine.findMany({
      where: { yardContainerId: id },
      select: { operationId: true },
      distinct: ['operationId'],
    });
    for (const { operationId } of linkedOperationIds) {
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: { storageBillingStartedAt: true, storageBillingEndedAt: true },
      });
      if (
        !operation?.storageBillingStartedAt ||
        operation.storageBillingEndedAt
      )
        continue;

      const allGateInDates = await this.prisma.yardContainer.findMany({
        where: {
          operationLines: { some: { operationId } },
          gateInDate: { not: null },
        },
        select: { gateInDate: true },
      });
      const dates = allGateInDates
        .map((c2) => c2.gateInDate)
        .filter((d): d is Date => !!d);
      if (!dates.length) continue;

      const newStart = new Date(Math.min(...dates.map((d) => d.getTime())));
      if (newStart.getTime() !== operation.storageBillingStartedAt.getTime()) {
        await this.prisma.operation.update({
          where: { id: operationId },
          data: { storageBillingStartedAt: newStart },
        });
      }
    }

    return updated;
  }

  // ── Gate-In ──────────────────────────────────────────────────────────────

  async gateIn(tenantId: string, operatorId: string, dto: GateInDto) {
    // Vérifie doublon numéro conteneur (même tenant, pas encore sorti)
    await this.assertContainerNumberFree(tenantId, dto.containerNumber);

    // Allocation + création du conteneur dans une seule transaction : l'allocation
    // verrouille la ligne yard_positions (FOR UPDATE) jusqu'au commit, ce qui
    // empêche deux gate-in concurrents de recevoir la même position.
    const { container, position } = await this.prisma.$transaction((tx) =>
      this.gateInWithTx(tx, tenantId, operatorId, dto),
    );

    // WebSocket : notifie la position occupée
    this.emitPositionOccupied(tenantId, position, container.id);

    // Retourne la position avec isOccupied à jour (pas le snapshot pre-transaction)
    return { container, position: { ...position, isOccupied: true } };
  }

  // Vérifie qu'aucun conteneur actif (non DEPARTED) ne porte déjà ce numéro
  // pour ce tenant — public et factorisé pour être appelable avant d'ouvrir
  // une transaction partagée (ex: gate-in multiple depuis
  // WmsService.createFile()).
  // Variante en lot (création de dossier / ajout de cargaison) : une seule
  // requête au lieu d'une par conteneur.
  async assertContainerNumbersFree(tenantId: string, numbers: string[]) {
    if (!numbers.length) return;
    const existing = await this.prisma.yardContainer.findMany({
      where: {
        tenantId,
        containerNumber: { in: numbers.map((n) => n.toUpperCase()) },
        status: { not: YardContainerStatus.DEPARTED },
      },
      select: { containerNumber: true, status: true },
    });
    if (existing.length) {
      throw new ConflictException(
        `Conteneur(s) déjà en yard : ${existing.map((e) => `${e.containerNumber} (${e.status})`).join(', ')}.`,
      );
    }
  }

  async assertContainerNumberFree(
    tenantId: string,
    containerNumber: string,
    // excludeId : conteneur en cours de correction — ne se bloque pas
    // lui-même (voir WmsService.updateCargoContainer()).
    excludeId?: string,
  ) {
    const existing = await this.prisma.yardContainer.findFirst({
      where: {
        tenantId,
        containerNumber: containerNumber.toUpperCase(),
        status: { not: YardContainerStatus.DEPARTED },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException(
        `Le conteneur ${containerNumber} est déjà en yard (${existing.status}).`,
      );
    }
  }

  // Public : réutilisé par WmsService.createFile() pour notifier le plan du
  // yard après le commit d'un gate-in "inline" fait via gateInWithTx().
  emitPositionOccupied(
    tenantId: string,
    position: {
      yardId: string;
      block: string;
      bay: number;
      row: number;
      tier: number;
    },
    containerId: string,
  ) {
    this.yardMapGateway.emitPositionUpdated(tenantId, {
      yardId: position.yardId,
      block: position.block,
      bay: position.bay,
      row: position.row,
      tier: position.tier,
      isOccupied: true,
      containerId,
    });
  }

  // Public : réutilisé par WmsService.deleteFile() pour notifier le plan du
  // yard après le commit d'une suppression de conteneur (dossier supprimé —
  // voir le commentaire de deleteFile() pour la règle d'exclusivité).
  emitPositionFreed(
    tenantId: string,
    position: {
      yardId: string;
      block: string;
      bay: number;
      row: number;
      tier: number;
    },
  ) {
    this.yardMapGateway.emitPositionUpdated(tenantId, {
      yardId: position.yardId,
      block: position.block,
      bay: position.bay,
      row: position.row,
      tier: position.tier,
      isOccupied: false,
      containerId: null,
    });
  }

  // Cœur du gate-in, extrait de gateIn() pour être réutilisable à l'intérieur
  // d'une transaction *déjà ouverte par un appelant externe* — voir
  // WmsService.createFile() qui crée un ou plusieurs conteneurs "inline" à la
  // création d'un dossier (ICD_FULL/ICD_EMPTY/DEP_TRANS/DEP_STOCK/EMP_EXPORT
  // avec cargaison CT), dans la MÊME transaction que le ShipmentFile et les
  // Operation/OperationLine associées. `excludePositionIds` doit être partagé
  // (même tableau, muté en place ou reconstruit par l'appelant) entre
  // plusieurs appels dans la même transaction pour éviter d'allouer deux fois
  // la même position à deux conteneurs du même lot — même logique que
  // gateInBulkFromPreGate() ci-dessous. L'appelant reste responsable d'émettre
  // yard:position:updated après le commit (voir emitPositionOccupied()) —
  // jamais depuis l'intérieur de la transaction, pour ne notifier qu'une fois
  // le commit garanti.
  async gateInWithTx(
    tx: PrismaTx,
    tenantId: string,
    operatorId: string,
    dto: GateInDto,
    excludePositionIds?: string[],
  ) {
    const position = dto.forcedPositionId
      ? await this.getAndLockPosition(dto.forcedPositionId, tx)
      : await this.autoAllocate(
          { ...dto, tenantId, yardId: dto.yardId },
          tx,
          excludePositionIds,
        );

    if (!position) {
      throw new BadRequestException(
        `Aucune position disponible pour le conteneur ${dto.containerNumber}.`,
      );
    }

    // yardId : depuis le DTO ou depuis la position allouée
    const resolvedYardId = dto.yardId ?? position.yardId;

    const payment = dto.paymentTerm
      ? await tx.payment.create({
          data: {
            tenantId,
            termType: dto.paymentTerm.termType,
            dueDate: dto.paymentTerm.dueDate
              ? new Date(dto.paymentTerm.dueDate)
              : undefined,
            notes: dto.paymentTerm.notes,
          },
        })
      : null;

    const c = await tx.yardContainer.create({
      data: {
        tenantId,
        clientId: dto.clientId,
        yardId: resolvedYardId,
        containerNumber: dto.containerNumber.toUpperCase(),
        isoTypeCode: dto.isoTypeCode.toUpperCase(),
        sizeFt: sizeForType(dto.isoTypeCode, dto.sizeFt),
        containerType: dto.containerType ?? ContainerType.DRY,
        grossWeightKg: dto.grossWeightKg,
        shippingLine: dto.shippingLine,
        voyageCode: dto.voyageCode,
        status: YardContainerStatus.IN_YARD,
        customsHold: dto.customsHold ?? false,
        isDangerousGoods: dto.isDangerousGoods ?? false,
        sealNumber: dto.sealNumber,
        gateInDate: dto.gateInDate ? new Date(dto.gateInDate) : new Date(),
        notes: dto.notes,
        yardPositionId: position.id,
        ...(payment ? { paymentId: payment.id } : {}),
      },
      select: CONTAINER_SELECT,
    });

    await tx.yardPosition.update({
      where: { id: position.id },
      data: { isOccupied: true },
    });

    await tx.yardMovement.create({
      data: {
        yardContainerId: c.id,
        toPositionId: position.id,
        movementType: YardMovementType.GATE_IN,
        operatorId,
        confirmedAt: new Date(),
      },
    });

    return { container: c, position };
  }

  // Gate-in RÉEL de plusieurs conteneurs en une seule fois — remplace N appels
  // séquentiels à gateInWithTx() DANS une même transaction interactive (ce qui
  // faisait tenir la transaction ouverte ~6×N aller-retours DB, dépassant le
  // timeout par défaut de 5s dès quelques conteneurs sous latence réseau
  // réelle — P2028 constaté en prod). Découpe le travail en deux phases :
  //   1. Allocation en lot (autoAllocateBatch, HORS transaction) : chaque
  //      position réclamée est marquée occupée immédiatement (UPDATE atomique
  //      Postgres, sa propre transaction implicite) — aucun verrou n'est tenu
  //      au-delà de cette seule requête par profil d'allocation.
  //   2. Création en lot (createMany conteneurs + mouvements, DANS une
  //      transaction courte) : quelques requêtes groupées au lieu de 6×N
  //      séquentielles, quelle que soit la taille du lot.
  // forcedPositionId n'est PAS supporté ici (aucun appelant actuel — createFile/
  // addCargo/gateInBulkFromPreGate — n'en a besoin sur ce chemin ; le gate-in
  // unitaire via gateInWithTx reste la voie pour une position forcée).
  // paymentTerm par item n'est pas non plus supporté (aucun appelant actuel
  // n'en fournit — le paiement, s'il y en a un, est géré par l'appelant au
  // niveau du dossier, pas par conteneur).
  //
  // tx optionnel : si fourni, les créations se font DANS cette transaction
  // appelante (déjà courte, ex. WmsService.createFile()) plutôt que d'en
  // ouvrir une nouvelle — seule l'allocation (étape 1) reste toujours hors
  // transaction, qu'un tx soit fourni ou non.
  async gateInBatch(
    tenantId: string,
    operatorId: string,
    items: GateInDto[],
    tx?: PrismaTx,
  ) {
    if (!items.length) return [];
    if (items.some((i) => i.forcedPositionId || i.paymentTerm))
      throw new BadRequestException(
        'gateInBatch ne supporte pas forcedPositionId/paymentTerm par conteneur — utiliser gateIn()/gateInWithTx() pour ce cas.',
      );

    // 1. Allocation en lot — HORS transaction, voir autoAllocateBatch().
    const positions = await this.autoAllocateBatch(
      items.map((i) => ({
        tenantId,
        yardId: i.yardId,
        isDangerousGoods: i.isDangerousGoods,
        containerType: i.containerType,
        grossWeightKg: i.grossWeightKg,
      })),
    );
    const unmet = items
      .map((i, idx) => (positions[idx] ? null : i.containerNumber))
      .filter((n): n is string => !!n);
    if (unmet.length) {
      // Libère les positions déjà réclamées par CE lot avant d'échouer — sans
      // ça elles resteraient occupées sans conteneur, un slot bloqué pour rien.
      const claimed = positions.filter((p): p is NonNullable<typeof p> => !!p);
      if (claimed.length) {
        await this.prisma.yardPosition.updateMany({
          where: { id: { in: claimed.map((p) => p.id) } },
          data: { isOccupied: false },
        });
      }
      throw new BadRequestException(
        `Aucune position disponible pour : ${unmet.join(', ')}.`,
      );
    }

    // 2. Création en lot — DANS une transaction courte (ou celle fournie).
    const run = async (client: PrismaTx | PrismaService) => {
      const ids = items.map(() => crypto.randomUUID());
      await client.yardContainer.createMany({
        data: items.map((dto, idx) => ({
          id: ids[idx],
          tenantId,
          clientId: dto.clientId,
          yardId: dto.yardId ?? positions[idx]!.yardId,
          containerNumber: dto.containerNumber.toUpperCase(),
          isoTypeCode: dto.isoTypeCode.toUpperCase(),
          sizeFt: sizeForType(dto.isoTypeCode, dto.sizeFt),
          containerType: dto.containerType ?? ContainerType.DRY,
          grossWeightKg: dto.grossWeightKg,
          shippingLine: dto.shippingLine,
          voyageCode: dto.voyageCode,
          status: YardContainerStatus.IN_YARD,
          customsHold: dto.customsHold ?? false,
          isDangerousGoods: dto.isDangerousGoods ?? false,
          sealNumber: dto.sealNumber,
          gateInDate: dto.gateInDate ? new Date(dto.gateInDate) : new Date(),
          notes: dto.notes,
          yardPositionId: positions[idx]!.id,
        })),
      });
      await client.yardMovement.createMany({
        data: items.map((_, idx) => ({
          yardContainerId: ids[idx],
          toPositionId: positions[idx]!.id,
          movementType: YardMovementType.GATE_IN,
          operatorId,
          confirmedAt: new Date(),
        })),
      });
      const containers = await client.yardContainer.findMany({
        where: { id: { in: ids } },
        select: CONTAINER_SELECT,
      });
      const byId = new Map(containers.map((c) => [c.id, c]));
      return ids.map((id, idx) => ({
        container: byId.get(id)!,
        position: positions[idx]!,
      }));
    };

    // Si la phase 2 échoue (ex. contrainte unique violée par une soumission
    // concurrente qui a glissé entre assertContainerNumberFree() et ici), les
    // conteneurs/mouvements sont bien annulés par le rollback de la
    // transaction — mais PAS les positions marquées occupées en phase 1
    // (committées hors transaction, par construction). Sans ce filet, elles
    // resteraient occupées indéfiniment sans conteneur associé.
    try {
      return await (tx ? run(tx) : this.prisma.$transaction((t) => run(t)));
    } catch (err) {
      await this.prisma.yardPosition.updateMany({
        where: { id: { in: positions.map((p) => p!.id) } },
        data: { isOccupied: false },
      });
      throw err;
    }
  }

  // Annonce (pré-alerte) de conteneurs à la CRÉATION d'un dossier — PAS un
  // gate-in réel : aucune position n'est allouée, aucun YardMovement n'est
  // créé, le conteneur est enregistré en GATE_IN_PROGRESS ("annoncé/attendu",
  // jamais utilisé ailleurs dans le code). Le vrai positionnement
  // (reserveCapacity) et le vrai Gate In (avec camion/chauffeur réels, voir
  // gateInBatch()) restent des étapes séparées à exécuter explicitement,
  // comme le prévoit le pipeline CORE_STEPS (capacity → entry_auth →
  // gate_in) — voir CLAUDE.md, table OPERATION_TYPES. Avant ce fix,
  // WmsService.createFile() appelait gateInBatch() directement, ce qui
  // plaçait le conteneur IN_YARD avec une position réelle dès la création du
  // dossier, avant même la validation N+1, le Bon à Entrer ou un quelconque
  // Gate In — bug rapporté en prod (« les conteneurs sont stockés
  // directement sans passer par le Gate In et le positionnement »).
  async announceContainers(
    tenantId: string,
    yardId: string,
    items: Array<{
      containerNumber: string;
      isoTypeCode: string;
      sizeFt?: number;
      containerType?: ContainerType;
      grossWeightKg?: number;
      shippingLine?: string;
      voyageCode?: string;
      customsHold?: boolean;
      isDangerousGoods?: boolean;
      sealNumber?: string;
      clientId?: string;
      notes?: string;
    }>,
    tx?: PrismaTx,
  ) {
    if (!items.length) return [];
    const client = tx ?? this.prisma;
    const ids = items.map(() => crypto.randomUUID());
    await client.yardContainer.createMany({
      data: items.map((dto, idx) => ({
        id: ids[idx],
        tenantId,
        clientId: dto.clientId,
        yardId,
        containerNumber: dto.containerNumber.toUpperCase(),
        isoTypeCode: dto.isoTypeCode.toUpperCase(),
        sizeFt: sizeForType(dto.isoTypeCode, dto.sizeFt),
        containerType: dto.containerType ?? ContainerType.DRY,
        grossWeightKg: dto.grossWeightKg,
        shippingLine: dto.shippingLine,
        voyageCode: dto.voyageCode,
        status: YardContainerStatus.GATE_IN_PROGRESS,
        customsHold: dto.customsHold ?? false,
        isDangerousGoods: dto.isDangerousGoods ?? false,
        sealNumber: dto.sealNumber,
        notes: dto.notes,
      })),
    });
    return client.yardContainer.findMany({
      where: { id: { in: ids } },
      select: CONTAINER_SELECT,
    });
  }

  // ── Gate-In depuis Pré-Gate ──────────────────────────────────────────────

  async gateInFromPreGate(
    tenantId: string,
    operatorId: string,
    dto: GateInFromPreGateDto,
  ) {
    // 1. Charge la PreGateLine avec sa PreGate parente
    const preGateLine = await this.prisma.preGateLine.findUnique({
      where: { id: dto.preGateLineId },
      include: { preGate: true },
    });
    if (!preGateLine) {
      throw new NotFoundException('Ligne pré-gate introuvable.');
    }

    // Vérification tenant
    if (preGateLine.preGate.tenantId !== tenantId) {
      throw new NotFoundException('Ligne pré-gate introuvable.');
    }

    // 2. Vérifier que la ligne est en statut EXPECTED
    if (preGateLine.status !== PreGateLineStatus.EXPECTED) {
      throw new BadRequestException(
        `La ligne pré-gate est déjà en statut ${preGateLine.status}.`,
      );
    }

    // 3. Vérifie doublon conteneur (même tenant, pas encore sorti)
    const existing = await this.prisma.yardContainer.findFirst({
      where: {
        tenantId,
        containerNumber: preGateLine.containerNumber.toUpperCase(),
        status: { not: YardContainerStatus.DEPARTED },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Le conteneur ${preGateLine.containerNumber} est déjà en yard (${existing.status}).`,
      );
    }

    // 4. Transaction — l'allocation se fait à l'intérieur (verrou FOR UPDATE
    // sur la position choisie, tenu jusqu'au commit).
    const { container, position, updatedPreGateLine } =
      await this.prisma.$transaction(async (tx) => {
        const position = await this.autoAllocate(
          {
            isDangerousGoods: preGateLine.isDangerousGoods,
            containerType: preGateLine.containerType,
            grossWeightKg: preGateLine.grossWeightKg,
            tenantId,
            yardId: dto.yardId,
          },
          tx,
        );

        if (!position) {
          throw new BadRequestException(
            'Aucune position disponible pour ce type de conteneur.',
          );
        }

        // Crée YardContainer avec status POSITIONING (pas encore positionné physiquement)
        const c = await tx.yardContainer.create({
          data: {
            tenantId,
            clientId: dto.clientId ?? preGateLine.preGate.clientId,
            yardId: dto.yardId,
            containerNumber: preGateLine.containerNumber.toUpperCase(),
            isoTypeCode: preGateLine.isoTypeCode.toUpperCase(),
            sizeFt: sizeForType(preGateLine.isoTypeCode, preGateLine.sizeFt),
            containerType: preGateLine.containerType ?? ContainerType.DRY,
            grossWeightKg: preGateLine.grossWeightKg,
            shippingLine:
              preGateLine.shippingLine ?? preGateLine.preGate.shippingLine,
            status: YardContainerStatus.POSITIONING,
            customsHold: preGateLine.customsHold ?? false,
            isDangerousGoods: preGateLine.isDangerousGoods ?? false,
            sealNumber: dto.sealNumber ?? preGateLine.sealNumber,
            gateInDate: dto.gateInDate ? new Date(dto.gateInDate) : new Date(),
            notes: dto.notes,
            driverName: dto.driverName,
            driverPhone: dto.driverPhone,
            truckPlate: dto.truckPlate,
            yardPositionId: position.id,
            preGateLineId: dto.preGateLineId,
            // Hérite de la modalité de paiement du pré-gate parent (un seul Payment,
            // partagé par tous les conteneurs de ce pré-gate)
            paymentId: preGateLine.preGate.paymentId,
          },
          select: CONTAINER_SELECT,
        });

        // La position choisie par autoAllocate() n'est qu'une SUGGESTION —
        // elle n'est marquée réellement occupée qu'à la confirmation terrain
        // (confirmPosition), seul moment où l'agent atteste l'emplacement
        // physique réel. Plusieurs conteneurs POSITIONING peuvent donc se
        // voir suggérer la même position libre tant qu'aucun n'a confirmé.

        // Update PreGateLine → ARRIVED + lien yardContainerId
        const updatedLine = await tx.preGateLine.update({
          where: { id: dto.preGateLineId },
          data: {
            status: PreGateLineStatus.ARRIVED,
            yardContainerId: c.id,
          },
        });

        // Recalcule le statut du pré-gate (IN_PROGRESS dès la 1ère ligne arrivée,
        // CLOSED automatiquement quand il n'y a plus de ligne EXPECTED)
        await this.recomputePreGateStatus(tx, preGateLine.preGateId);

        // Crée YardMovement type GATE_IN (sans confirmedAt — sera confirmé au confirm-position)
        await tx.yardMovement.create({
          data: {
            yardContainerId: c.id,
            toPositionId: position.id,
            movementType: YardMovementType.GATE_IN,
            operatorId,
          },
        });

        return { container: c, position, updatedPreGateLine: updatedLine };
      });

    return { container, position, preGateLine: updatedPreGateLine };
  }

  // ── Gate-In depuis Pré-Gate (bulk) ───────────────────────────────────────
  // Réceptionne plusieurs lignes d'un même pré-gate en une seule transaction —
  // sur le modèle de receiveShipment() côté WMS, qui traite déjà plusieurs
  // lignes en une fois.
  async gateInBulkFromPreGate(
    tenantId: string,
    operatorId: string,
    dto: GateInBulkFromPreGateDto,
  ) {
    const lines = await this.prisma.preGateLine.findMany({
      where: { id: { in: dto.preGateLineIds } },
      include: { preGate: true },
    });

    if (lines.length !== dto.preGateLineIds.length) {
      throw new NotFoundException(
        'Une ou plusieurs lignes pré-gate sont introuvables.',
      );
    }
    for (const line of lines) {
      if (line.preGate.tenantId !== tenantId) {
        throw new NotFoundException(
          'Une ou plusieurs lignes pré-gate sont introuvables.',
        );
      }
      if (line.status !== PreGateLineStatus.EXPECTED) {
        throw new BadRequestException(
          `Le conteneur ${line.containerNumber} est déjà en statut ${line.status}.`,
        );
      }
    }
    const preGateId = lines[0].preGateId;
    if (lines.some((l) => l.preGateId !== preGateId)) {
      throw new BadRequestException(
        'Toutes les lignes doivent appartenir au même pré-gate.',
      );
    }

    const containerNumbers = lines.map((l) => l.containerNumber.toUpperCase());
    const existing = await this.prisma.yardContainer.findFirst({
      where: {
        tenantId,
        containerNumber: { in: containerNumbers },
        status: { not: YardContainerStatus.DEPARTED },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Le conteneur ${existing.containerNumber} est déjà en yard (${existing.status}).`,
      );
    }

    const results: {
      container: unknown;
      position: {
        id: string;
        block: string;
        bay: number;
        row: number;
        tier: number;
        yardId: string;
      };
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      const usedPositionIds: string[] = [];

      for (const line of lines) {
        const position = await this.autoAllocate(
          {
            isDangerousGoods: line.isDangerousGoods,
            containerType: line.containerType,
            grossWeightKg: line.grossWeightKg,
            tenantId,
            yardId: dto.yardId,
          },
          tx,
          usedPositionIds,
        );
        if (!position) {
          throw new BadRequestException(
            `Aucune position disponible pour le conteneur ${line.containerNumber}.`,
          );
        }
        usedPositionIds.push(position.id);

        const c = await tx.yardContainer.create({
          data: {
            tenantId,
            clientId: dto.clientId ?? line.preGate.clientId,
            yardId: dto.yardId,
            containerNumber: line.containerNumber.toUpperCase(),
            isoTypeCode: line.isoTypeCode.toUpperCase(),
            sizeFt: sizeForType(line.isoTypeCode, line.sizeFt),
            containerType: line.containerType ?? ContainerType.DRY,
            grossWeightKg: line.grossWeightKg,
            shippingLine: line.shippingLine ?? line.preGate.shippingLine,
            status: YardContainerStatus.POSITIONING,
            customsHold: line.customsHold ?? false,
            isDangerousGoods: line.isDangerousGoods ?? false,
            sealNumber: line.sealNumber,
            gateInDate: dto.gateInDate ? new Date(dto.gateInDate) : new Date(),
            notes: dto.notes,
            driverName: dto.driverName,
            driverPhone: dto.driverPhone,
            truckPlate: dto.truckPlate,
            yardPositionId: position.id,
            preGateLineId: line.id,
            paymentId: line.preGate.paymentId,
          },
          select: CONTAINER_SELECT,
        });

        // La position n'est qu'une suggestion — voir gateInFromPreGate() pour
        // le détail : elle n'est marquée occupée qu'à confirmPosition().

        await tx.preGateLine.update({
          where: { id: line.id },
          data: { status: PreGateLineStatus.ARRIVED, yardContainerId: c.id },
        });

        await tx.yardMovement.create({
          data: {
            yardContainerId: c.id,
            toPositionId: position.id,
            movementType: YardMovementType.GATE_IN,
            operatorId,
          },
        });

        results.push({ container: c, position });
      }

      await this.recomputePreGateStatus(tx, preGateId);
    });

    return { results, preGateId };
  }

  // Recalcule le statut du PreGate d'après ses lignes : passe à IN_PROGRESS
  // dès qu'au moins une ligne est ARRIVED, et à CLOSED automatiquement dès
  // qu'il n'y a plus aucune ligne EXPECTED (toutes ARRIVED/REJECTED/EXTRA).
  private async recomputePreGateStatus(tx: PrismaTx, preGateId: string) {
    const preGate = await tx.preGate.findUnique({
      where: { id: preGateId },
      select: { status: true },
    });
    if (!preGate || preGate.status === PreGateStatus.CLOSED) return;

    const [expectedCount, arrivedCount] = await Promise.all([
      tx.preGateLine.count({
        where: { preGateId, status: PreGateLineStatus.EXPECTED },
      }),
      tx.preGateLine.count({
        where: { preGateId, status: PreGateLineStatus.ARRIVED },
      }),
    ]);

    if (expectedCount === 0) {
      await tx.preGate.update({
        where: { id: preGateId },
        data: { status: PreGateStatus.CLOSED },
      });
    } else if (arrivedCount >= 1 && preGate.status === PreGateStatus.OPEN) {
      await tx.preGate.update({
        where: { id: preGateId },
        data: { status: PreGateStatus.IN_PROGRESS },
      });
    }
  }

  // ── Confirm-Position (terrain) ───────────────────────────────────────────

  async confirmPosition(
    id: string,
    tenantId: string,
    operatorId: string,
    dto: ConfirmPositionDto,
  ) {
    // 1. Charge le conteneur (doit être POSITIONING, même tenant)
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId, status: YardContainerStatus.POSITIONING },
    });
    if (!container) {
      throw new NotFoundException(
        'Conteneur introuvable ou pas en attente de positionnement.',
      );
    }

    const isSamePosition = container.yardPositionId === dto.positionId;
    const oldPositionId = container.yardPositionId;

    // 2. Transaction — la vérification de disponibilité de la nouvelle
    // position (si changement) se fait à l'intérieur, avec verrou FOR UPDATE.
    await this.prisma.$transaction(async (tx) => {
      if (!isSamePosition) {
        const newPos = await this.getAndLockPosition(dto.positionId, tx);
        if (!newPos) {
          throw new BadRequestException(
            'Position cible introuvable ou déjà occupée.',
          );
        }
      }

      // Update YardContainer : status → IN_YARD, position confirmée
      await tx.yardContainer.update({
        where: { id },
        data: {
          status: YardContainerStatus.IN_YARD,
          yardPositionId: dto.positionId,
        },
      });

      // Marque la nouvelle position occupée
      await tx.yardPosition.update({
        where: { id: dto.positionId },
        data: { isOccupied: true },
      });

      // Si changement de position : libère l'ancienne
      if (!isSamePosition && oldPositionId) {
        await tx.yardPosition.update({
          where: { id: oldPositionId },
          data: { isOccupied: false },
        });
      }

      if (isSamePosition) {
        // Même position : met à jour le mouvement GATE_IN existant avec confirmedAt
        const lastGateIn = await tx.yardMovement.findFirst({
          where: {
            yardContainerId: id,
            movementType: YardMovementType.GATE_IN,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (lastGateIn) {
          await tx.yardMovement.update({
            where: { id: lastGateIn.id },
            data: { confirmedAt: new Date(), notes: dto.notes },
          });
        }
      } else {
        // Changement de position : crée un mouvement REPOSITION
        await tx.yardMovement.create({
          data: {
            yardContainerId: id,
            fromPositionId: oldPositionId,
            toPositionId: dto.positionId,
            movementType: YardMovementType.REPOSITION,
            operatorId,
            confirmedAt: new Date(),
            notes: dto.notes,
          },
        });
      }
    });

    // 4. Émet WebSocket pour la nouvelle position occupée
    const newPosition = await this.prisma.yardPosition.findUnique({
      where: { id: dto.positionId },
    });
    if (newPosition) {
      this.yardMapGateway.emitPositionUpdated(tenantId, {
        yardId: newPosition.yardId,
        block: newPosition.block,
        bay: newPosition.bay,
        row: newPosition.row,
        tier: newPosition.tier,
        isOccupied: true,
        containerId: id,
      });
    }

    // Si changement de position, émet aussi pour l'ancienne libérée
    if (!isSamePosition && oldPositionId) {
      const oldPosition = await this.prisma.yardPosition.findUnique({
        where: { id: oldPositionId },
      });
      if (oldPosition) {
        this.yardMapGateway.emitPositionUpdated(tenantId, {
          yardId: oldPosition.yardId,
          block: oldPosition.block,
          bay: oldPosition.bay,
          row: oldPosition.row,
          tier: oldPosition.tier,
          isOccupied: false,
          containerId: null,
        });
      }
    }

    const updatedContainer = await this.prisma.yardContainer.findUnique({
      where: { id },
      select: CONTAINER_SELECT,
    });

    return { ok: true, container: updatedContainer, position: newPosition };
  }

  // ── Gate-Out ─────────────────────────────────────────────────────────────

  async gateOut(
    id: string,
    tenantId: string,
    operatorId: string,
    dto: GateOutDto,
  ) {
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId },
      include: { payment: { select: { termType: true, status: true } } },
    });
    if (!container) throw new NotFoundException('Conteneur introuvable.');
    if (container.status === YardContainerStatus.DEPARTED) {
      throw new BadRequestException('Ce conteneur a déjà quitté le yard.');
    }
    if (container.status === YardContainerStatus.POSITIONING) {
      throw new BadRequestException(
        'Ce conteneur est en attente de positionnement — confirmez son emplacement avant la sortie.',
      );
    }
    if (container.isBeingDevanned) {
      throw new BadRequestException(
        'Ce conteneur est en cours de dépotage — marquez la fin de dépotage avant la sortie.',
      );
    }
    // Dépotage en cours dans un dossier : pas de sortie avant le déchargement
    // (sinon les étapes du dépotage n'ont plus de conteneur sur site).
    const depotLines = await this.prisma.operationLine.findMany({
      where: {
        yardContainerId: id,
        done: false,
        operation: {
          tenantId,
          type: { in: [OperationType.DEP_TRANS, OperationType.DEP_STOCK] },
        },
      },
      select: {
        stepIdx: true,
        operation: { select: { type: true, shipmentFile: { select: { voyageCode: true } } } },
      },
    });
    for (const l of depotLines) {
      const steps = OPERATION_TYPE_CFG[l.operation.type].steps;
      const unloadIdx = steps.findIndex((s) => /^(Déchargement|Dépotage)$/.test(s));
      if (unloadIdx >= 0 && l.stepIdx <= unloadIdx)
        throw new BadRequestException(
          `Ce conteneur n'est pas encore dépoté (dossier ${l.operation.shipmentFile.voyageCode}, étape « ${steps[l.stepIdx]} ») — terminez le déchargement avant de le sortir.`,
        );
    }
    this.paymentsService.assertGateOutAllowed(container.payment);

    if (dto.regularization && (!dto.gateOutDate || !dto.notes?.trim()))
      throw new BadRequestException(
        'Régularisation : la date réelle de sortie et le motif sont obligatoires.',
      );
    const transport = dto.regularization
      ? {
          transportMode: null,
          vehicleId: null as string | null,
          driverId: null as string | null,
          truckPlate: null as string | null,
          carrier: null as string | null,
          driverName: null as string | null,
          driverCin: null as string | null,
          permitNo: null as string | null,
        }
      : await this.tmsService.resolveGateTransport(tenantId, {
          ...dto,
          allowInUse: true,
        });

    const fromPositionId = container.yardPositionId;
    const gateOutAt = dto.gateOutDate ? new Date(dto.gateOutDate) : new Date();
    // Date de sortie saisie (sortie réelle antérieure possible) : jamais dans
    // le futur ni avant l'entrée — elle arrête le décompte du séjour facturé.
    if (gateOutAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date de sortie ne peut pas être dans le futur.',
      );
    if (container.gateInDate && gateOutAt < container.gateInDate)
      throw new BadRequestException(
        "La date de sortie ne peut pas précéder la date d'entrée du conteneur.",
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.yardContainer.update({
        where: { id },
        data: {
          status: YardContainerStatus.DEPARTED,
          gateOutDate: gateOutAt,
          yardPositionId: null,
          notes: dto.notes ?? container.notes,
          driverName: transport.driverName,
          truckPlate: transport.truckPlate,
          gateOutCarrier: transport.carrier,
          gateOutDriverCin: transport.driverCin,
          gateOutPermitNo: transport.permitNo,
          ...(dto.destination !== undefined && {
            destination: dto.destination,
          }),
        },
      });

      if (fromPositionId) {
        await tx.yardPosition.update({
          where: { id: fromPositionId },
          data: { isOccupied: false },
        });
      }

      await tx.yardMovement.create({
        data: {
          yardContainerId: id,
          fromPositionId,
          movementType: YardMovementType.GATE_OUT,
          operatorId,
          // Date RÉELLE de sortie (historique du conteneur).
          confirmedAt: gateOutAt,
          notes: dto.regularization
            ? `Régularisation : ${dto.notes?.trim()}`
            : dto.notes,
        },
      });
    });

    await this.closeStayIfAllDeparted(tenantId, id);

    // Le camion repart avec le conteneur : clôt sa visite au registre Gate
    // et libère un camion de la flotte interne (resté « En mission » sinon).
    if (transport.truckPlate)
      await this.gateRegistry
        .checkOut(tenantId, transport.truckPlate, gateOutAt)
        .catch(() => undefined);
    if (transport.vehicleId)
      await this.gateRegistry
        .releaseTmsVehicle(transport.vehicleId)
        .catch(() => undefined);

    // WebSocket : notifie la position libérée si elle existait
    if (fromPositionId) {
      const pos = await this.prisma.yardPosition.findUnique({
        where: { id: fromPositionId },
      });
      if (pos) {
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
    }

    return { ok: true };
  }

  // ── Dépotage ─────────────────────────────────────────────────────────────

  // Fin de dépotage manuelle — l'agent yard constate physiquement que le
  // conteneur est vide, indépendamment du statut des dossiers WMS liés
  // (le déchargement physique et la réception informatique ne coïncident
  // pas toujours). Lève le badge et autorise le Gate OUT.
  async endDevanning(id: string, tenantId: string) {
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId },
    });
    if (!container) throw new NotFoundException('Conteneur introuvable.');
    if (!container.isBeingDevanned) {
      throw new BadRequestException(
        "Ce conteneur n'est pas en cours de dépotage.",
      );
    }

    return this.prisma.yardContainer.update({
      where: { id },
      data: { isBeingDevanned: false, containerType: ContainerType.EMPTY },
      select: CONTAINER_SELECT,
    });
  }

  // ── Repositionnement ─────────────────────────────────────────────────────

  async reposition(
    id: string,
    tenantId: string,
    operatorId: string,
    dto: RepositionDto,
  ) {
    const container = await this.prisma.yardContainer.findFirst({
      where: { id, tenantId, status: YardContainerStatus.IN_YARD },
    });
    if (!container) {
      throw new NotFoundException('Conteneur introuvable ou pas en yard.');
    }

    // Vérification préalable hors transaction (blocDef, non sensible à la race
    // condition) — la disponibilité réelle est re-vérifiée sous verrou ci-dessous.
    const previewPosition = await this.prisma.yardPosition.findFirst({
      where: {
        id: dto.toPositionId,
        isOccupied: false,
        yard: { tenantId },
      },
    });
    if (!previewPosition) {
      throw new BadRequestException(
        'Position cible introuvable ou déjà occupée.',
      );
    }
    if (previewPosition.yardBlockDefId) {
      const blockDef = await this.prisma.yardBlockDef.findUnique({
        where: { id: previewPosition.yardBlockDefId },
      });
      if (blockDef && !this.blockAcceptsContainer(blockDef, container)) {
        throw new BadRequestException(
          `Le bloc ${blockDef.code} n'accepte pas ce type de conteneur.`,
        );
      }
    }

    const fromPositionId = container.yardPositionId;

    await this.prisma.$transaction(async (tx) => {
      // Re-vérifie et verrouille la position cible (FOR UPDATE) — protège
      // contre un autre gate-in/reposition/confirm-position concurrent.
      const toPosition = await this.getAndLockPosition(dto.toPositionId, tx);
      if (!toPosition) {
        throw new BadRequestException(
          'Position cible introuvable ou déjà occupée.',
        );
      }

      await tx.yardContainer.update({
        where: { id },
        data: { yardPositionId: dto.toPositionId },
      });

      await tx.yardPosition.update({
        where: { id: dto.toPositionId },
        data: { isOccupied: true },
      });

      if (fromPositionId) {
        await tx.yardPosition.update({
          where: { id: fromPositionId },
          data: { isOccupied: false },
        });
      }

      await tx.yardMovement.create({
        data: {
          yardContainerId: id,
          fromPositionId,
          toPositionId: dto.toPositionId,
          movementType: YardMovementType.REPOSITION,
          operatorId,
          confirmedAt: new Date(),
          notes: dto.notes,
        },
      });
    });

    // WebSocket : deux émissions (from libérée, to occupée)
    const [fromPos, toPos] = await Promise.all([
      fromPositionId
        ? this.prisma.yardPosition.findUnique({ where: { id: fromPositionId } })
        : Promise.resolve(null),
      this.prisma.yardPosition.findUnique({ where: { id: dto.toPositionId } }),
    ]);

    if (fromPos) {
      this.yardMapGateway.emitPositionUpdated(tenantId, {
        yardId: fromPos.yardId,
        block: fromPos.block,
        bay: fromPos.bay,
        row: fromPos.row,
        tier: fromPos.tier,
        isOccupied: false,
        containerId: null,
      });
    }
    if (toPos) {
      this.yardMapGateway.emitPositionUpdated(tenantId, {
        yardId: toPos.yardId,
        block: toPos.block,
        bay: toPos.bay,
        row: toPos.row,
        tier: toPos.tier,
        isOccupied: true,
        containerId: id,
      });
    }

    return { ok: true, toPositionId: dto.toPositionId };
  }

  // ── Yard Map (positions) ──────────────────────────────────────────────────

  async getYardMap(tenantId: string, yardId?: string) {
    await releaseAbandonedYardPositions(this.prisma, tenantId);
    // Retourne toutes les positions (du yard demandé, sinon tous) avec le conteneur occupant si présent.
    // POSITIONING est exclu : yardPositionId n'y est encore qu'une suggestion,
    // pas un emplacement confirmé — la position doit rester visuellement
    // libre sur le plan tant que confirmPosition() n'a pas eu lieu.
    const positions = await this.prisma.yardPosition.findMany({
      where: { ...(yardId ? { yardId } : {}) },
      include: {
        containers: {
          where: {
            tenantId,
            status: {
              notIn: [
                YardContainerStatus.DEPARTED,
                YardContainerStatus.POSITIONING,
              ],
            },
          },
          select: {
            id: true,
            containerNumber: true,
            isoTypeCode: true,
            containerType: true,
            isDangerousGoods: true,
            grossWeightKg: true,
            status: true,
            clientId: true,
          },
        },
      },
      orderBy: [
        { block: 'asc' },
        { bay: 'asc' },
        { row: 'asc' },
        { tier: 'asc' },
      ],
    });

    return positions;
  }

  async getPositions(tenantId: string, block?: string, yardId?: string) {
    return this.prisma.yardPosition.findMany({
      where: {
        ...(block ? { block } : {}),
        // Un même code de bloc peut exister dans deux dépôts (DMT 1 / DMT 2).
        ...(yardId ? { yardId } : {}),
        isOccupied: false,
        yard: { tenantId },
      },
      orderBy: [
        { block: 'asc' },
        { bay: 'asc' },
        { row: 'asc' },
        { tier: 'asc' },
      ],
    });
  }

  // ── Mouvements ───────────────────────────────────────────────────────────

  async listMovements(
    tenantId: string,
    params: { type?: YardMovementType; skip?: number; take?: number } = {},
  ) {
    const { type, skip = 0, take = 50 } = params;
    const containerIds = await this.prisma.yardContainer
      .findMany({ where: { tenantId }, select: { id: true } })
      .then((cs) => cs.map((c) => c.id));

    return this.prisma.yardMovement.findMany({
      where: {
        yardContainerId: { in: containerIds },
        ...(type ? { movementType: type } : {}),
      },
      include: {
        container: { select: { containerNumber: true, isoTypeCode: true } },
        fromPosition: true,
        toPosition: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  // client optionnel : passer `tx` quand appelé dans une transaction (ce qui
  // doit toujours être le cas pour une allocation destinée à être persistée —
  // voir `allocateAndLockPosition`). Sans `tx`, la lecture n'est pas verrouillée
  // et ne doit servir qu'à une vérification préalable (ex: aperçu avant
  // ouverture de la transaction), jamais à l'allocation finale.
  // excludePositionIds : positions déjà attribuées à d'autres lignes du même
  // bulk, en plus du verrou FOR UPDATE SKIP LOCKED qui protège contre les
  // gate-in concurrents dans d'autres requêtes.
  private async autoAllocate(
    dto: AllocationParams,
    client?: PrismaTx,
    excludePositionIds?: string[],
  ) {
    const db = client ?? this.prisma;
    const { tenantId, yardId, isDangerousGoods, containerType, grossWeightKg } =
      dto;
    const forceGround = grossWeightKg && grossWeightKg > 25000;

    // 1. Charger tous les YardBlockDef actifs du yard
    const allDefs = await db.yardBlockDef.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(yardId ? { yardId } : {}),
        isActive: true,
      },
    });

    // 2. Filtrer les blocs candidats selon les flags du conteneur
    const candidateDefs = allDefs.filter((d) =>
      this.blockAcceptsContainer(d, { isDangerousGoods, containerType }),
    );

    if (candidateDefs.length === 0) return null;

    const candidateBlockCodes = candidateDefs.map((d) => d.code);

    // 3. Cherche la première position libre au tier le plus bas dans ces blocs.
    // Dans une transaction (`client` fourni), verrouille la ligne choisie avec
    // FOR UPDATE SKIP LOCKED : deux transactions concurrentes ne peuvent plus
    // lire/choisir la même position libre — la seconde ignore les lignes déjà
    // verrouillées par la première et prend la suivante disponible.
    if (client) {
      const excluded = excludePositionIds?.length ? excludePositionIds : [''];
      const rows = await client.$queryRaw<{ id: string }[]>`
        SELECT id FROM yard_positions
        WHERE block = ANY(${candidateBlockCodes})
          ${yardId ? Prisma.sql`AND "yardId" = ${yardId}` : Prisma.empty}
          AND "isOccupied" = false
          AND id NOT IN (${Prisma.join(excluded)})
          ${forceGround ? Prisma.sql`AND tier = 1` : Prisma.empty}
        ORDER BY tier ASC, bay ASC, row ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (!rows.length) return null;
      return client.yardPosition.findUnique({ where: { id: rows[0].id } });
    }

    return db.yardPosition.findFirst({
      where: {
        block: { in: candidateBlockCodes },
        ...(yardId ? { yardId } : {}),
        isOccupied: false,
        ...(excludePositionIds?.length
          ? { id: { notIn: excludePositionIds } }
          : {}),
        ...(forceGround ? { tier: 1 } : {}),
      },
      orderBy: [{ tier: 'asc' }, { bay: 'asc' }, { row: 'asc' }],
    });
  }

  // Allocation en LOT — réclame N positions pour PLUSIEURS conteneurs en UNE
  // seule requête par profil d'allocation (dangerousGoods/containerType/
  // forceGround), au lieu d'un aller-retour FOR UPDATE SKIP LOCKED par
  // conteneur. Miroir "sans conteneur physique attaché" de autoAllocate(),
  // pensé pour être appelé HORS de toute transaction interactive : chaque
  // UPDATE...RETURNING est sa propre transaction implicite Postgres, atomique
  // et instantanément committée — les positions réclamées sont marquées
  // isOccupied=true immédiatement, donc aucun verrou n'est tenu au-delà de
  // cette seule requête. Voir gateInBatch()/WmsService.createFile() pour le
  // contexte : un lot de N conteneurs ne doit plus jamais faire tenir une
  // transaction interactive ouverte le temps de N allocations séquentielles
  // (P2028 constaté en prod avec le timeout par défaut de 5s dès 5
  // conteneurs sous latence réseau réelle).
  //
  // Retourne un tableau de positions dans le MÊME ORDRE que `items`, ou lève
  // si l'une d'elles n'a pas pu être satisfaite (pas de rollback partiel
  // nécessaire : chaque position déjà réclamée par un autre item du lot est
  // déjà marquée occupée en base de façon définitive et légitime — seul
  // l'appelant décide s'il faut les libérer en cas d'échec global, voir
  // gateInBatch()).
  async autoAllocateBatch(
    items: AllocationParams[],
  ): Promise<Array<ClaimedPosition | null>> {
    if (!items.length) return [];

    // Groupe les items par profil d'allocation identique (mêmes blocs
    // candidats + même contrainte de tier) pour réclamer tout un groupe en
    // une seule requête, plutôt qu'une requête par item.
    type Group = {
      key: string;
      tenantId?: string;
      yardId?: string;
      candidateBlockCodes: string[];
      forceGround: boolean;
      indices: number[];
    };
    const groups = new Map<string, Group>();
    for (let i = 0; i < items.length; i++) {
      const {
        tenantId,
        yardId,
        isDangerousGoods,
        containerType,
        grossWeightKg,
      } = items[i];
      const allDefs = await this.prisma.yardBlockDef.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(yardId ? { yardId } : {}),
          isActive: true,
        },
      });
      const candidateDefs = allDefs.filter((d) =>
        this.blockAcceptsContainer(d, { isDangerousGoods, containerType }),
      );
      const candidateBlockCodes = candidateDefs.map((d) => d.code).sort();
      const forceGround = !!(grossWeightKg && grossWeightKg > 25000);
      const key = JSON.stringify([
        tenantId,
        yardId,
        candidateBlockCodes,
        forceGround,
      ]);
      const g = groups.get(key);
      if (g) g.indices.push(i);
      else
        groups.set(key, {
          key,
          tenantId,
          yardId,
          candidateBlockCodes,
          forceGround,
          indices: [i],
        });
    }

    const result: Array<ClaimedPosition | null> = new Array<null>(
      items.length,
    ).fill(null);

    for (const g of groups.values()) {
      if (!g.candidateBlockCodes.length) continue; // reste null pour ces indices
      const n = g.indices.length;
      // UPDATE...FROM(SELECT...FOR UPDATE SKIP LOCKED LIMIT n) : réclame
      // atomiquement jusqu'à n positions libres en une seule requête,
      // équivalent en lot du autoAllocate() unitaire.
      const rows = await this.prisma.$queryRaw<ClaimedPosition[]>`
        UPDATE yard_positions
        SET "isOccupied" = true
        WHERE id IN (
          SELECT id FROM yard_positions
          WHERE block = ANY(${g.candidateBlockCodes})
            ${g.yardId ? Prisma.sql`AND "yardId" = ${g.yardId}` : Prisma.empty}
            AND "isOccupied" = false
            ${g.forceGround ? Prisma.sql`AND tier = 1` : Prisma.empty}
          ORDER BY tier ASC, bay ASC, row ASC
          LIMIT ${n}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "yardId", block, bay, row, tier
      `;
      // Ordre non garanti par le RETURNING — réassigne aux indices du groupe
      // dans l'ordre où les positions ont été réclamées (peu importe lequel
      // reçoit quelle position tant que chacun en reçoit une distincte).
      for (let k = 0; k < g.indices.length; k++) {
        result[g.indices[k]] = rows[k] ?? null;
      }
    }

    return result;
  }

  private blockAcceptsContainer(
    blockDef: YardBlockDef,
    container: { isDangerousGoods?: boolean; containerType?: ContainerType },
  ): boolean {
    if (container.isDangerousGoods) return blockDef.allowDangerousGoods;
    if (container.containerType === ContainerType.REEFER)
      return blockDef.allowReefer;
    // Un bloc « tous types » accepte aussi les vides (seuls IMDG et reefers
    // pleins exigent un bloc dédié) — sinon un dépôt sans bloc « vides »
    // ne pouvait réserver aucun emplacement pour des conteneurs vides.
    if (container.containerType === ContainerType.EMPTY)
      return blockDef.allowEmpty || blockDef.allowAllTypes;
    return blockDef.allowAllTypes;
  }

  // Séjour facturé d'une opération (ICD : sortie par le Gate OUT du parc) :
  // clôturé quand TOUS ses conteneurs sont sortis, à la date de sortie la
  // plus tardive — avant, la sortie YMS ne clôturait jamais le séjour.
  private async closeStayIfAllDeparted(tenantId: string, containerId: string) {
    const links = await this.prisma.operationLine.findMany({
      where: { yardContainerId: containerId, operation: { tenantId } },
      select: { operationId: true },
      distinct: ['operationId'],
    });
    const rules = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stayWeekendsIncluded: true },
    });
    for (const { operationId } of links) {
      const op = await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: {
          type: true,
          status: true,
          shipmentFileId: true,
          storageBillingStartedAt: true,
          storageBillingEndedAt: true,
          storageFreetimeDays: true,
          lines: {
            where: { yardContainerId: { not: null } },
            select: {
              done: true,
              yardContainer: { select: { status: true, gateOutDate: true } },
            },
          },
        },
      });
      if (!op) continue;
      const boxes = op.lines.map((l) => l.yardContainer).filter(Boolean);
      const allDeparted =
        boxes.length > 0 &&
        boxes.every((b) => b!.status === YardContainerStatus.DEPARTED);
      // Stockage ICD terminé et tous ses conteneurs sortis par le Gate OUT :
      // l'opération est SORTIE, et le dossier aussi si tout est terminé.
      if (
        allDeparted &&
        (op.type === OperationType.ICD_FULL || op.type === OperationType.ICD_EMPTY) &&
        op.lines.every((l) => l.done) &&
        op.status === OperationStatus.EN_STOCK
      ) {
        await this.prisma.operation.update({
          where: { id: operationId },
          data: { status: OperationStatus.SORTI },
        });
        const others = await this.prisma.operation.count({
          where: {
            shipmentFileId: op.shipmentFileId,
            status: { notIn: [OperationStatus.SORTI, OperationStatus.DOSSIER_CLOS] },
          },
        });
        if (!others)
          await this.prisma.shipmentFile.update({
            where: { id: op.shipmentFileId },
            data: { status: 'FULLY_OUT' },
          });
      }
      if (!op.storageBillingStartedAt || op.storageBillingEndedAt) continue;
      if (!allDeparted) continue;
      const end = new Date(
        Math.max(...boxes.map((b) => (b!.gateOutDate ?? new Date()).getTime())),
      );
      const days = countStayDays(
        op.storageBillingStartedAt,
        end,
        rules?.stayWeekendsIncluded ?? true,
      );
      await this.prisma.operation.update({
        where: { id: operationId },
        data: {
          storageBillingEndedAt: end,
          storageBillableDays: stayBillableDays(days, op.storageFreetimeDays ?? 0),
        },
      });
    }
  }

  // client optionnel : passer `tx` pour verrouiller la ligne (FOR UPDATE)
  // jusqu'au commit de la transaction appelante — voir autoAllocate() pour
  // le détail du problème que ceci évite. Sans `tx`, lecture non verrouillée.
  private async getAndLockPosition(positionId: string, client?: PrismaTx) {
    if (client) {
      const rows = await client.$queryRaw<{ id: string }[]>`
        SELECT id FROM yard_positions
        WHERE id = ${positionId} AND "isOccupied" = false
        FOR UPDATE
      `;
      if (!rows.length) return null;
      return client.yardPosition.findUnique({ where: { id: rows[0].id } });
    }
    return this.prisma.yardPosition.findFirst({
      where: { id: positionId, isOccupied: false },
    });
  }
}
