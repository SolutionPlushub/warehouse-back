import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GateTruckPurpose,
  OperationType,
  TruckLoadStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GateRegistryService,
  normalizePlate,
} from '../tms/gate-registry.service';
import { OPERATION_TYPE_CFG } from './operation-types';
import { OperationsService } from './operations.service';
import {
  CreateTruckLoadDto,
  TruckLoadDeliverDto,
  TruckLoadGateOutDto,
} from './dto/truck-load.dto';
import {
  pickupWaitBand,
  pickupWaitHours,
  pickupDetentionDays,
} from './pickup-wait.constants';

// Étape de transbordement à laquelle les chargements camion sont saisis.
const LOADING_STEP = 'Chargement camion';
const LOADING_TYPES: OperationType[] = [OperationType.DEP_TRANS];
const loadingStepIdx = (type: OperationType) =>
  OPERATION_TYPE_CFG[type].steps.indexOf(LOADING_STEP);

const ACTIVE_LOAD = { not: TruckLoadStatus.CANCELLED };

/**
 * Chargements camion — gestion des chargements partiels (transbordement).
 * Un camion emporte une partie de la marchandise de plusieurs conteneurs,
 * éventuellement de dossiers différents ; un conteneur peut être réparti
 * sur plusieurs camions. Chaque chargement est tracé jusqu'à la sortie du
 * site et la livraison.
 */
// Colis de référence d'une unité pour le chargement : constatés au pointage
// (> 0), sinon attendus (nb colis saisi sur le conteneur). Un pointage à 0
// (aucun nombre connu au moment du pointage) ne bloque plus le chargement.
const refQty = (l: { quantity: number | null; expectedQuantity: number | null }) =>
  l.quantity && l.quantity > 0 ? l.quantity : (l.expectedQuantity ?? l.quantity);

@Injectable()
export class TruckLoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateRegistry: GateRegistryService,
    private readonly operations: OperationsService,
  ) {}

  /** Quantité déjà chargée (hors chargements annulés), par unité. */
  async loadedByLine(operationLineIds: string[]) {
    const rows = await this.prisma.truckLoadLine.groupBy({
      by: ['operationLineId'],
      where: {
        operationLineId: { in: operationLineIds },
        truckLoad: { status: ACTIVE_LOAD },
      },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.operationLineId, r._sum.quantity ?? 0]));
  }

  /** Unités à l'étape « Chargement camion », avec le reste à charger. */
  async candidates(tenantId: string) {
    const lines = await this.prisma.operationLine.findMany({
      where: {
        done: false,
        yardContainerId: { not: null },
        operation: { tenantId, type: { in: LOADING_TYPES } },
      },
      include: {
        yardContainer: { select: { containerNumber: true, sizeFt: true } },
        operation: {
          select: {
            id: true,
            type: true,
            shipmentFile: {
              select: {
                id: true,
                voyageCode: true,
                client: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const atLoading = lines.filter(
      (l) => l.stepIdx === loadingStepIdx(l.operation.type),
    );
    const loaded = await this.loadedByLine(atLoading.map((l) => l.id));
    return atLoading.map((l) => {
      const done = loaded.get(l.id) ?? 0;
      return {
        operationLineId: l.id,
        operationId: l.operation.id,
        fileId: l.operation.shipmentFile.id,
        dossier: l.operation.shipmentFile.voyageCode,
        client: l.operation.shipmentFile.client?.name ?? null,
        container: l.yardContainer?.containerNumber ?? null,
        sizeFt: l.yardContainer?.sizeFt ?? null,
        // Colis constatés au pointage, sinon attendus (nb colis du conteneur).
        counted: refQty(l),
        expected: l.expectedQuantity,
        loaded: done,
        remaining: refQty(l) != null ? Math.max(0, refQty(l)! - done) : null,
      };
    });
  }

  async create(tenantId: string, userId: string, dto: CreateTruckLoadDto) {
    const plate = dto.plate.trim().toUpperCase();
    const plateNorm = normalizePlate(plate);
    if (!plateNorm)
      throw new BadRequestException("L'immatriculation est requise.");
    const ids = dto.lines.map((l) => l.operationLineId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'Une même unité apparaît deux fois dans ce chargement — regroupez les quantités.',
      );

    const lines = await this.prisma.operationLine.findMany({
      where: { id: { in: ids }, operation: { tenantId } },
      include: {
        yardContainer: { select: { containerNumber: true } },
        operation: { select: { id: true, type: true, shipmentFileId: true } },
      },
    });
    if (lines.length !== ids.length)
      throw new NotFoundException('Unité introuvable pour ce chargement.');
    const loaded = await this.loadedByLine(ids);
    for (const req of dto.lines) {
      const l = lines.find((x) => x.id === req.operationLineId)!;
      const label = l.yardContainer?.containerNumber ?? l.id;
      if (
        !LOADING_TYPES.includes(l.operation.type) ||
        l.done ||
        l.stepIdx !== loadingStepIdx(l.operation.type)
      )
        throw new BadRequestException(
          `${label} n'est pas à l'étape « ${LOADING_STEP} ».`,
        );
      const ref = refQty(l);
      if (ref != null) {
        const remaining = ref - (loaded.get(l.id) ?? 0);
        if (req.quantity > remaining)
          throw new BadRequestException(
            `${label} : ${req.quantity} colis demandés, ${Math.max(0, remaining)} restant(s) à charger.`,
          );
      }
    }

    const visit = await this.prisma.gateTruckVisit.findFirst({
      where: { tenantId, plateNorm, status: 'ON_SITE' },
      orderBy: { gateInAt: 'desc' },
      select: { id: true, purpose: true },
    });
    // Le camion qui charge est le récepteur du transbordement (cycle propre).
    if (visit && !visit.purpose)
      await this.prisma.gateTruckVisit.update({
        where: { id: visit.id },
        data: {
          purpose: GateTruckPurpose.RECEIVER,
          shipmentFileId: lines[0].operation.shipmentFileId,
        },
      });
    // Date réelle du chargement (rattrapage : saisie après coup).
    const now = dto.loadedAt ? new Date(dto.loadedAt) : new Date();
    if (now.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date de chargement ne peut pas être dans le futur.',
      );
    const load = await this.prisma.$transaction(async (tx) => {
      const created = await tx.truckLoad.create({
        data: {
          tenantId,
          plate,
          plateNorm,
          carrier: dto.carrier?.trim() || null,
          driverName: dto.driverName.trim(),
          driverCin: dto.driverCin?.trim() || null,
          permitNo: dto.permitNo?.trim() || null,
          destination: dto.destination?.trim() || null,
          deliveryRef: dto.deliveryRef?.trim() || null,
          notes: dto.notes?.trim() || null,
          truckVisitId: visit?.id ?? null,
          createdById: userId,
          loadedAt: now,
          lines: {
            create: dto.lines.map((req) => {
              const l = lines.find((x) => x.id === req.operationLineId)!;
              return {
                operationLineId: l.id,
                operationId: l.operation.id,
                shipmentFileId: l.operation.shipmentFileId,
                yardContainerId: l.yardContainerId,
                quantity: req.quantity,
              };
            }),
          },
        },
        include: { lines: true },
      });
      // Compatibilité : dernier camion de reprise + début d'attente sur
      // l'unité (suivi « en attente douane », détention camion, pré-remplissage
      // de la sortie camion).
      for (const l of lines) {
        await tx.operationLine.update({
          where: { id: l.id },
          data: {
            pickupTruckPlate: plate,
            pickupTruckCarrier: dto.carrier?.trim() || null,
            pickupDriverName: dto.driverName.trim(),
            pickupDriverCin: dto.driverCin?.trim() || null,
            pickupPermitNo: dto.permitNo?.trim() || null,
            ...(l.pickupLoadedAt ? {} : { pickupLoadedAt: now }),
          },
        });
      }
      return created;
    });
    return load;
  }

  private async findLoad(tenantId: string, id: string) {
    const load = await this.prisma.truckLoad.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!load) throw new NotFoundException('Chargement introuvable.');
    return load;
  }

  /** Sortie du site d'un camion chargé. */
  async gateOut(
    tenantId: string,
    id: string,
    dto: TruckLoadGateOutDto,
    userId?: string,
    role?: UserRole,
  ) {
    const load = await this.findLoad(tenantId, id);
    if (load.status !== TruckLoadStatus.LOADED)
      throw new BadRequestException('Ce camion est déjà sorti ou annulé.');
    const at = dto.gateOutAt ? new Date(dto.gateOutAt) : new Date();
    this.assertExitDate(at, load.loadedAt);
    const updated = await this.prisma.truckLoad.update({
      where: { id },
      data: {
        status: TruckLoadStatus.EXITED,
        gateOutAt: at,
        ...(dto.deliveryRef !== undefined
          ? { deliveryRef: dto.deliveryRef.trim() || null }
          : {}),
      },
    });
    // Clôt la visite Gate du camion s'il n'a plus aucun chargement sur site.
    const stillLoaded = await this.prisma.truckLoad.count({
      where: {
        tenantId,
        plateNorm: load.plateNorm,
        status: TruckLoadStatus.LOADED,
      },
    });
    if (!stillLoaded)
      await this.gateRegistry
        .checkOut(tenantId, load.plate, at)
        .catch(() => undefined);
    // Gate out du camion chargé = « Sortie camion » des unités dont tous les
    // camions sont sortis (arrêt du compteur, facture au dernier camion).
    if (userId && role) {
      const byOp = new Map<string, string[]>();
      for (const l of load.lines)
        byOp.set(l.operationId, [...(byOp.get(l.operationId) ?? []), l.operationLineId]);
      for (const [opId, lineIds] of byOp)
        await this.operations.autoTruckExit(opId, lineIds, tenantId, userId, role);
    }
    return updated;
  }

  // Date réelle de sortie : ni dans le futur, ni avant le chargement.
  private assertExitDate(at: Date, loadedAt: Date) {
    if (at.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date de sortie ne peut pas être dans le futur.',
      );
    if (at < loadedAt)
      throw new BadRequestException(
        'La date de sortie ne peut pas précéder le chargement du camion.',
      );
  }

  /** Correction de la date de sortie d'un camion déjà sorti (saisie tardive). */
  async updateGateOutDate(tenantId: string, id: string, gateOutIso: string) {
    const load = await this.findLoad(tenantId, id);
    if (
      load.status !== TruckLoadStatus.EXITED &&
      load.status !== TruckLoadStatus.DELIVERED
    )
      throw new BadRequestException("Ce camion n'est pas encore sorti.");
    const at = new Date(gateOutIso);
    this.assertExitDate(at, load.loadedAt);
    if (load.deliveredAt && at > load.deliveredAt)
      throw new BadRequestException(
        'La date de sortie ne peut pas être postérieure à la livraison.',
      );
    return this.prisma.truckLoad.update({
      where: { id },
      data: { gateOutAt: at },
    });
  }

  async deliver(tenantId: string, id: string, dto: TruckLoadDeliverDto) {
    const load = await this.findLoad(tenantId, id);
    if (load.status !== TruckLoadStatus.EXITED)
      throw new BadRequestException(
        'Seul un camion sorti du site peut être marqué livré.',
      );
    const deliveredAt = dto.deliveredAt ? new Date(dto.deliveredAt) : new Date();
    if (deliveredAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La date de livraison ne peut pas être dans le futur.',
      );
    if (load.gateOutAt && deliveredAt < load.gateOutAt)
      throw new BadRequestException(
        'La date de livraison ne peut pas précéder la sortie du camion.',
      );
    return this.prisma.truckLoad.update({
      where: { id },
      data: {
        status: TruckLoadStatus.DELIVERED,
        deliveredAt,
        ...(dto.deliveryRef !== undefined
          ? { deliveryRef: dto.deliveryRef.trim() || null }
          : {}),
      },
    });
  }

  /** Annule un chargement saisi par erreur (camion encore sur site). */
  async cancel(tenantId: string, id: string) {
    const load = await this.findLoad(tenantId, id);
    if (load.status !== TruckLoadStatus.LOADED)
      throw new BadRequestException(
        'Seul un chargement encore sur site peut être annulé.',
      );
    const lines = await this.prisma.operationLine.findMany({
      where: { id: { in: load.lines.map((l) => l.operationLineId) } },
      include: { operation: { select: { type: true } } },
    });
    if (
      lines.some(
        (l) => l.done || l.stepIdx !== loadingStepIdx(l.operation.type),
      )
    )
      throw new BadRequestException(
        "L'étape « Chargement camion » est déjà validée pour une de ces unités — revenez d'abord à l'étape précédente.",
      );
    return this.prisma.truckLoad.update({
      where: { id },
      data: { status: TruckLoadStatus.CANCELLED },
    });
  }

  /**
   * Camions chargés — par défaut ceux encore sur site après transbordement
   * (LOADED), avec durée d'attente et seuils ; `status=ALL` pour l'historique.
   */
  async list(tenantId: string, status?: string) {
    const where =
      status === 'ALL'
        ? { tenantId, status: ACTIVE_LOAD }
        : {
            tenantId,
            status:
              (status as TruckLoadStatus) &&
              Object.values(TruckLoadStatus).includes(status as TruckLoadStatus)
                ? (status as TruckLoadStatus)
                : TruckLoadStatus.LOADED,
          };
    const loads = await this.prisma.truckLoad.findMany({
      where,
      include: {
        lines: {
          include: {
            operationLine: {
              select: {
                quantity: true,
                stepIdx: true,
                done: true,
                yardContainer: { select: { containerNumber: true } },
              },
            },
          },
        },
      },
      orderBy: { loadedAt: status === 'ALL' ? 'desc' : 'asc' },
      take: 300,
    });
    const fileIds = [
      ...new Set(loads.flatMap((l) => l.lines.map((x) => x.shipmentFileId))),
    ];
    const files = await this.prisma.shipmentFile.findMany({
      where: { id: { in: fileIds }, tenantId },
      select: {
        id: true,
        voyageCode: true,
        client: { select: { name: true, truckFreetimeHours: true } },
      },
    });
    const fileById = new Map(files.map((f) => [f.id, f]));
    const now = new Date();
    const items = loads.map((l) => {
      const hours = pickupWaitHours(l.loadedAt, l.gateOutAt ?? now);
      return {
        id: l.id,
        plate: l.plate,
        carrier: l.carrier,
        driverName: l.driverName,
        driverCin: l.driverCin,
        permitNo: l.permitNo,
        destination: l.destination,
        deliveryRef: l.deliveryRef,
        status: l.status,
        loadedAt: l.loadedAt,
        gateOutAt: l.gateOutAt,
        deliveredAt: l.deliveredAt,
        hours: Math.round(hours * 10) / 10,
        band: pickupWaitBand(hours),
        // Franchise du client du (premier) dossier chargé.
        detentionDays: pickupDetentionDays(
          hours,
          fileById.get(l.lines[0]?.shipmentFileId)?.client?.truckFreetimeHours,
        ),
        totalQuantity: l.lines.reduce((s, x) => s + x.quantity, 0),
        lines: l.lines.map((x) => ({
          id: x.id,
          operationLineId: x.operationLineId,
          operationId: x.operationId,
          fileId: x.shipmentFileId,
          dossier: fileById.get(x.shipmentFileId)?.voyageCode ?? null,
          client: fileById.get(x.shipmentFileId)?.client?.name ?? null,
          container: x.operationLine.yardContainer?.containerNumber ?? null,
          quantity: x.quantity,
          counted: x.operationLine.quantity,
        })),
      };
    });
    const onSite = items.filter((i) => i.status === TruckLoadStatus.LOADED);
    return {
      items,
      stats: {
        onSite: onSite.length,
        over40h: onSite.filter((i) => i.band === 'alert').length,
        avgHours: onSite.length
          ? Math.round(
              (onSite.reduce((s, i) => s + i.hours, 0) / onSite.length) * 10,
            ) / 10
          : 0,
        detention: onSite.filter((i) => i.detentionDays > 0).length,
      },
    };
  }
}
