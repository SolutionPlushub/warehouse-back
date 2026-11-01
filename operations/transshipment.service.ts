import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContainerType,
  GateTruckPurpose,
  GateTruckVisitStatus,
  OperationType,
  TruckLoadStatus,
  UserRole,
  YardContainerStatus,
  YardMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { YardMapGateway } from '../yard-map/yard-map.gateway';
import {
  GateRegistryService,
  normalizePlate,
} from '../tms/gate-registry.service';
import { OperationsService } from './operations.service';
import { TruckLoadsService } from './truck-loads.service';
import { OPERATION_TYPE_CFG } from './operation-types';
import {
  CarrierExitDto,
  ReceiverGateInDto,
  TransshipExitDto,
} from './dto/transshipment.dto';
import {
  PICKUP_DETENTION_FREE_HOURS,
  pickupDetentionDays,
  pickupWaitBand,
  pickupWaitHours,
} from './pickup-wait.constants';

const STEPS = OPERATION_TYPE_CFG[OperationType.DEP_TRANS].steps;
const UNLOAD_IDX = STEPS.indexOf('Déchargement');

// Date réelle saisie : jamais dans le futur.
const realDate = (iso: string | undefined, what: string) => {
  const at = iso ? new Date(iso) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000)
    throw new BadRequestException(`La date ${what} ne peut pas être dans le futur.`);
  return at;
};

/**
 * Transbordement — un camion, un cycle (workflow DMT 2026-10-25) :
 *  - porteurs : entrent avec les conteneurs pleins (Gate In du dossier),
 *    repartent avec le conteneur vide dès la fin du dépotage, sans facture ;
 *  - récepteurs : entrent vides, chargent la marchandise (Chargements
 *    camions), sortent quand leur mission est livrée — ce gate out arrête
 *    leur compteur d'attente et, pour le dernier, émet la facture ;
 *  - clôture du dossier quand plus aucun camion n'est sur le parc.
 */
@Injectable()
export class TransshipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateRegistry: GateRegistryService,
    private readonly operations: OperationsService,
    private readonly truckLoads: TruckLoadsService,
    private readonly yardMapGateway: YardMapGateway,
  ) {}

  private async transshipOp(fileId: string, tenantId: string) {
    const op = await this.prisma.operation.findFirst({
      where: { shipmentFileId: fileId, tenantId, type: OperationType.DEP_TRANS },
      orderBy: { createdAt: 'asc' },
      include: {
        lines: {
          where: { yardContainerId: { not: null } },
          include: {
            yardContainer: {
              select: {
                id: true,
                containerNumber: true,
                sizeFt: true,
                status: true,
                gateInDate: true,
                gateOutDate: true,
                truckPlate: true,
                yardPositionId: true,
                yardPosition: {
                  select: { yardId: true, block: true, bay: true, row: true, tier: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        gatePasses: { orderBy: { gateInDate: 'asc' } },
      },
    });
    if (!op)
      throw new BadRequestException("Ce dossier n'a pas d'opération de transbordement.");
    return op;
  }

  /** Option 2 du Gate In : camion vide qui vient charger la marchandise. */
  async receiverGateIn(
    fileId: string,
    tenantId: string,
    userId: string,
    dto: ReceiverGateInDto,
  ) {
    await this.transshipOp(fileId, tenantId);
    const plateNorm = normalizePlate(dto.plate);
    if (!plateNorm) throw new BadRequestException("L'immatriculation est requise.");
    const onSite = await this.prisma.gateTruckVisit.findFirst({
      where: { tenantId, plateNorm, status: GateTruckVisitStatus.ON_SITE },
      select: { shipmentFileId: true, purpose: true },
    });
    if (onSite?.shipmentFileId && onSite.shipmentFileId !== fileId)
      throw new BadRequestException(
        'Ce camion est déjà sur le parc pour un autre dossier — enregistrez d’abord sa sortie.',
      );
    if (onSite?.purpose === GateTruckPurpose.CARRIER)
      throw new BadRequestException(
        'Ce camion est sur le parc comme porteur de ce dossier — enregistrez d’abord sa sortie.',
      );
    const at = realDate(dto.gateInAt, "d'entrée");
    const visit = await this.gateRegistry.checkIn(
      tenantId,
      {
        plate: dto.plate,
        carrier: dto.carrier.trim(),
        driverName: dto.driverName.trim(),
        driverCin: dto.driverCin.trim(),
        permitNo: dto.permitNo?.trim() || null,
      },
      userId,
      at,
    );
    return this.prisma.gateTruckVisit.update({
      where: { id: visit.id },
      data: { shipmentFileId: fileId, purpose: GateTruckPurpose.RECEIVER },
    });
  }

  /**
   * Sortie d'un camion récepteur : chargé → gate out de ses chargements
   * (arrêt du compteur, sortie camion et facture si c'est le dernier) ;
   * vide → simple sortie du registre Gate.
   */
  async receiverExit(
    fileId: string,
    tenantId: string,
    userId: string,
    role: UserRole,
    visitId: string,
    dto: TransshipExitDto,
  ) {
    const visit = await this.prisma.gateTruckVisit.findFirst({
      where: { id: visitId, tenantId, shipmentFileId: fileId },
    });
    if (!visit) throw new NotFoundException('Camion introuvable sur ce dossier.');
    if (visit.status !== GateTruckVisitStatus.ON_SITE)
      throw new BadRequestException('Ce camion est déjà sorti.');
    const at = realDate(dto.gateOutAt, 'de sortie');
    if (at < visit.gateInAt)
      throw new BadRequestException("La date de sortie ne peut pas précéder l'entrée du camion.");
    const loads = await this.prisma.truckLoad.findMany({
      where: { tenantId, plateNorm: visit.plateNorm, status: TruckLoadStatus.LOADED },
      select: { id: true },
    });
    for (const l of loads)
      await this.truckLoads.gateOut(
        tenantId,
        l.id,
        { gateOutAt: at.toISOString(), deliveryRef: dto.deliveryRef },
        userId,
        role,
      );
    await this.gateRegistry.checkOut(tenantId, visit.plate, at);
    return { ok: true, loads: loads.length };
  }

  /**
   * Sortie partielle des porteurs : le conteneur repart vide dès la fin du
   * dépotage. Aucun effet sur les camions chargés, aucune facturation.
   */
  async carrierExit(
    fileId: string,
    tenantId: string,
    userId: string,
    dto: CarrierExitDto,
  ) {
    const op = await this.transshipOp(fileId, tenantId);
    const lines = op.lines.filter((l) => dto.operationLineIds.includes(l.id));
    if (lines.length !== dto.operationLineIds.length)
      throw new NotFoundException('Conteneur introuvable dans ce transbordement.');
    const at = realDate(dto.gateOutAt, 'de sortie');
    for (const l of lines) {
      const c = l.yardContainer!;
      if (c.status === YardContainerStatus.DEPARTED)
        throw new BadRequestException(`${c.containerNumber} est déjà sorti.`);
      if (!l.done && l.stepIdx <= UNLOAD_IDX)
        throw new BadRequestException(
          `${c.containerNumber} n'est pas encore dépoté (étape « ${STEPS[l.stepIdx]} ») — le porteur sort après le déchargement.`,
        );
      if (c.gateInDate && at < c.gateInDate)
        throw new BadRequestException(
          `La date de sortie de ${c.containerNumber} précède son entrée.`,
        );
    }
    const plateOf = (lineId: string) =>
      op.gatePasses.find((p) => p.arrivedOperationLineIds.includes(lineId))
        ?.truckPlate ?? null;

    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const c = l.yardContainer!;
        await tx.yardContainer.update({
          where: { id: c.id },
          data: {
            status: YardContainerStatus.DEPARTED,
            containerType: ContainerType.EMPTY,
            isBeingDevanned: false,
            gateOutDate: at,
            yardPositionId: null,
            ...(plateOf(l.id) ? { truckPlate: plateOf(l.id) } : {}),
          },
        });
        if (c.yardPositionId)
          await tx.yardPosition.update({
            where: { id: c.yardPositionId },
            data: { isOccupied: false },
          });
        await tx.yardMovement.create({
          data: {
            yardContainerId: c.id,
            fromPositionId: c.yardPositionId,
            movementType: YardMovementType.GATE_OUT,
            operatorId: userId,
            confirmedAt: at,
            notes: 'Sortie porteur après dépotage (transbordement)',
          },
        });
      }
    });

    for (const l of lines) {
      const pos = l.yardContainer!.yardPosition;
      if (pos)
        this.yardMapGateway.emitPositionUpdated(tenantId, {
          ...pos,
          isOccupied: false,
          containerId: null,
        });
    }

    // Le porteur quitte le registre Gate quand tous ses conteneurs sont sortis.
    const exitedIds = new Set(lines.map((l) => l.id));
    for (const pass of op.gatePasses) {
      if (!pass.arrivedOperationLineIds.some((id) => exitedIds.has(id))) continue;
      const stillIn = op.lines.some(
        (l) =>
          pass.arrivedOperationLineIds.includes(l.id) &&
          !exitedIds.has(l.id) &&
          l.yardContainer?.status !== YardContainerStatus.DEPARTED,
      );
      if (!stillIn)
        await this.gateRegistry.checkOut(tenantId, pass.truckPlate, at).catch(() => undefined);
    }

    // Sortie camion déjà faite : « Retour conteneur vide » se valide d'office.
    await this.operations.completeEmptyReturns(op.id, [...exitedIds], userId);
    await this.operations.finishIfDone(op.id);
    return { ok: true, count: lines.length };
  }

  /** Vue des deux flux, traçabilité conteneur → camion, clôture et journal. */
  async overview(fileId: string, tenantId: string) {
    const op = await this.transshipOp(fileId, tenantId);
    const lineIds = op.lines.map((l) => l.id);
    // Franchise du camion chargé : propre au client du dossier.
    const file = await this.prisma.shipmentFile.findUnique({
      where: { id: fileId },
      select: { client: { select: { truckFreetimeHours: true } } },
    });
    const freeHours =
      file?.client?.truckFreetimeHours ?? PICKUP_DETENTION_FREE_HOURS;
    const [loads, receiverVisits, carrierVisits, logs] = await Promise.all([
      this.prisma.truckLoad.findMany({
        where: {
          tenantId,
          status: { not: TruckLoadStatus.CANCELLED },
          lines: { some: { shipmentFileId: fileId } },
        },
        include: { lines: { where: { shipmentFileId: fileId } } },
        orderBy: { loadedAt: 'asc' },
      }),
      this.prisma.gateTruckVisit.findMany({
        where: { tenantId, shipmentFileId: fileId, purpose: GateTruckPurpose.RECEIVER },
        orderBy: { gateInAt: 'asc' },
      }),
      this.prisma.gateTruckVisit.findMany({
        where: {
          tenantId,
          id: { in: op.gatePasses.map((p) => p.truckVisitId).filter((x): x is string => !!x) },
        },
        select: { id: true, status: true, gateOutAt: true },
      }),
      this.prisma.operationStepLog.findMany({
        where: { operationLineId: { in: lineIds } },
        select: { operationLineId: true, stepLabel: true, performedAt: true },
        orderBy: { performedAt: 'asc' },
      }),
    ]);
    const now = new Date();
    const lineById = new Map(op.lines.map((l) => [l.id, l]));
    const containerOf = (id: string) => lineById.get(id)?.yardContainer?.containerNumber ?? null;

    const unit = (l: (typeof op.lines)[number]) => {
      const c = l.yardContainer!;
      const departed = c.status === YardContainerStatus.DEPARTED;
      const unloaded = l.done || l.stepIdx > UNLOAD_IDX;
      return {
        operationLineId: l.id,
        container: c.containerNumber,
        sizeFt: c.sizeFt,
        stepIdx: l.stepIdx,
        step: l.done ? 'Terminé' : STEPS[l.stepIdx],
        arrived: c.status !== YardContainerStatus.POSITIONING && !!c.gateInDate,
        unloaded,
        departed,
        gateOutAt: departed ? c.gateOutDate : null,
        canExit: !departed && unloaded,
        loadedOn: loads.flatMap((t) =>
          t.lines
            .filter((x) => x.operationLineId === l.id)
            .map((x) => ({ plate: t.plate, quantity: x.quantity })),
        ),
      };
    };

    const carriers = op.gatePasses.map((p) => {
      const v = carrierVisits.find((x) => x.id === p.truckVisitId);
      return {
        passId: p.id,
        plate: p.truckPlate,
        carrier: p.carrier,
        driverName: p.driverName,
        gateInAt: p.gateInDate,
        onSite: v ? v.status === GateTruckVisitStatus.ON_SITE : true,
        gateOutAt: v?.gateOutAt ?? null,
        units: op.lines.filter((l) => p.arrivedOperationLineIds.includes(l.id)).map(unit),
      };
    });
    const arrivedIds = new Set(op.gatePasses.flatMap((p) => p.arrivedOperationLineIds));
    const expected = op.lines.filter((l) => !arrivedIds.has(l.id)).map(unit);

    // Flux 2 : un cycle par camion récepteur (visite Gate), avec ses
    // chargements ; un chargement sans entrée « récepteur » saisie forme son
    // propre cycle (camions chargés avant ce workflow).
    const loadView = (t: (typeof loads)[number]) => ({
      id: t.id,
      status: t.status,
      loadedAt: t.loadedAt,
      gateOutAt: t.gateOutAt,
      deliveredAt: t.deliveredAt,
      deliveryRef: t.deliveryRef,
      destination: t.destination,
      quantity: t.lines.reduce((s, x) => s + x.quantity, 0),
      lines: t.lines.map((x) => ({
        operationLineId: x.operationLineId,
        container: containerOf(x.operationLineId),
        quantity: x.quantity,
      })),
    });
    const used = new Set<string>();
    const receivers = receiverVisits.map((v) => {
      const own = loads.filter(
        (t) =>
          t.truckVisitId === v.id ||
          (!t.truckVisitId && t.plateNorm === v.plateNorm && t.loadedAt >= v.gateInAt),
      );
      own.forEach((t) => used.add(t.id));
      return { visit: v, own };
    });
    for (const t of loads)
      if (!used.has(t.id)) receivers.push({ visit: null as never, own: [t] });

    const receiverView = receivers.map(({ visit, own }) => {
      const onSiteLoad = own.some((t) => t.status === TruckLoadStatus.LOADED);
      const exitedAt = own.length
        ? own.every((t) => t.gateOutAt)
          ? new Date(Math.max(...own.map((t) => t.gateOutAt!.getTime())))
          : null
        : (visit?.gateOutAt ?? null);
      const onSite = visit ? visit.status === GateTruckVisitStatus.ON_SITE || onSiteLoad : onSiteLoad;
      const firstLoad = own[0]?.loadedAt ?? null;
      // Compteur d'attente : du chargement au gate out du camion chargé.
      const hours = firstLoad ? pickupWaitHours(firstLoad, exitedAt ?? now) : 0;
      const state = !own.length
        ? onSite ? 'WAITING_LOAD' : 'EXITED_EMPTY'
        : onSiteLoad ? 'LOADED' : own.every((t) => t.status === TruckLoadStatus.DELIVERED) ? 'DELIVERED' : 'EXITED';
      return {
        visitId: visit?.id ?? null,
        plate: visit?.plate ?? own[0]?.plate ?? null,
        carrier: visit?.carrier ?? own[0]?.carrier ?? null,
        driverName: visit?.driverName ?? own[0]?.driverName ?? null,
        driverCin: visit?.driverCin ?? own[0]?.driverCin ?? null,
        permitNo: visit?.permitNo ?? own[0]?.permitNo ?? null,
        gateInAt: visit?.gateInAt ?? null,
        gateOutAt: onSite ? null : exitedAt,
        onSite,
        state,
        hours: Math.round(hours * 10) / 10,
        band: firstLoad ? pickupWaitBand(hours) : 'ok',
        detentionDays: firstLoad ? pickupDetentionDays(hours, freeHours) : 0,
        quantity: own.reduce((s, t) => s + t.lines.reduce((a, x) => a + x.quantity, 0), 0),
        loads: own.map(loadView),
      };
    });

    const traceability = loads.flatMap((t) =>
      t.lines.map((x) => ({
        container: containerOf(x.operationLineId),
        plate: t.plate,
        quantity: x.quantity,
        loadedAt: t.loadedAt,
        status: t.status,
      })),
    );

    const blockers = await this.operations.transshipBlockers(fileId, tenantId);

    type Ev = { at: Date; flow: 'CARRIER' | 'RECEIVER' | 'STEP'; label: string };
    const journal: Ev[] = [];
    for (const c of carriers) {
      journal.push({
        at: c.gateInAt,
        flow: 'CARRIER',
        label: `Gate In porteur ${c.plate} — ${c.units.map((u) => u.container).join(', ')}`,
      });
      for (const u of c.units)
        if (u.departed && u.gateOutAt)
          journal.push({ at: u.gateOutAt, flow: 'CARRIER', label: `Sortie porteur ${c.plate} — ${u.container} vide` });
    }
    for (const r of receiverView) {
      if (r.gateInAt) journal.push({ at: r.gateInAt, flow: 'RECEIVER', label: `Gate In camion vide ${r.plate}` });
      for (const t of r.loads) {
        journal.push({
          at: t.loadedAt,
          flow: 'RECEIVER',
          label: `Chargement ${r.plate} — ${t.lines.map((x) => `${x.container} (${x.quantity} colis)`).join(', ')}`,
        });
        if (t.gateOutAt) journal.push({ at: t.gateOutAt, flow: 'RECEIVER', label: `Gate out camion chargé ${r.plate}` });
        if (t.deliveredAt) journal.push({ at: t.deliveredAt, flow: 'RECEIVER', label: `Livraison confirmée ${r.plate}` });
      }
      if (r.state === 'EXITED_EMPTY' && r.gateOutAt)
        journal.push({ at: r.gateOutAt, flow: 'RECEIVER', label: `Sortie à vide ${r.plate}` });
    }
    for (const g of logs)
      journal.push({
        at: g.performedAt ?? new Date(0),
        flow: 'STEP',
        label: `${g.stepLabel} — ${containerOf(g.operationLineId) ?? ''}`,
      });
    journal.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      operationId: op.id,
      operationStatus: op.status,
      steps: STEPS,
      freeHours,
      carriers,
      expected,
      receivers: receiverView,
      traceability,
      canClose: blockers.length === 0,
      blockers,
      journal: journal.slice(0, 200),
    };
  }
}
