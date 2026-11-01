import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  OperationType,
  YardContainerStatus,
  YardMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { countStayDays, normalizeStayEngine } from '../stay-engine/stay-engine';

/** État de franchise d'un conteneur sur site. */
export type FranchiseState = 'ok' | 'soon' | 'today' | 'over' | 'none';

export interface ContainerFranchise {
  freetimeDays: number;
  stayDays: number;
  // Jours de franchise restants (négatif = dépassée).
  remaining: number;
  // Jours au-delà de la franchise = jours de surestarie à facturer.
  overDays: number;
  state: FranchiseState;
  // Origine de la franchise appliquée : dossier, client (plein/vide), défaut.
  source: 'dossier' | 'client' | 'client_empty' | 'default';
}

// Franchise par défaut quand ni le dossier ni le client n'en portent une.
const DEFAULT_FREETIME = 3;
const DAY = 86_400_000;
const IN_YARD: YardContainerStatus[] = [
  YardContainerStatus.IN_YARD,
  YardContainerStatus.GATE_OUT_PROGRESS,
  YardContainerStatus.ON_HOLD,
  YardContainerStatus.POSITIONING,
];
const evpOf = (sizeFt: number | null | undefined) => ((sizeFt ?? 20) >= 40 ? 2 : 1);

type FranchiseInput = {
  id: string;
  gateInDate: Date | null;
  gateOutDate?: Date | null;
  containerType: string;
  clientId: string | null;
};

/**
 * Parc conteneurs et fiche client : franchise RÉELLE par conteneur (avant :
 * 3 jours codés en dur, 2 en reefer, sans tenir compte du client ni du
 * dossier), indicateurs du parc et synthèse par client.
 *
 * Franchise appliquée, par ordre de priorité : celle fixée sur le dossier
 * (Operation.storageFreetimeDays, posée au placement), puis celle du contrat
 * client (vides : emptyFreetimeDays si renseignée, sinon franchise pleins),
 * puis 3 jours. Le séjour suit le moteur de séjour du tenant (week-ends).
 */
@Injectable()
export class ParkService {
  constructor(private readonly prisma: PrismaService) {}

  private async stayRules(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stayWeekendsIncluded: true, stayAlertLeadDays: true },
    });
    return normalizeStayEngine({
      weekendsIncluded: t?.stayWeekendsIncluded,
      alertLeadDays: t?.stayAlertLeadDays,
    });
  }

  /** Franchise de chaque conteneur (par id). */
  async franchiseOf(tenantId: string, containers: FranchiseInput[]) {
    const out = new Map<string, ContainerFranchise & { dossier: { id: string; voyageCode: string } | null }>();
    if (!containers.length) return out;
    const rules = await this.stayRules(tenantId);
    const clientIds = [...new Set(containers.map((c) => c.clientId).filter(Boolean))] as string[];
    const [clients, opLines] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, defaultFreetimeDays: true, emptyFreetimeDays: true },
      }),
      this.prisma.operationLine.findMany({
        where: { yardContainerId: { in: containers.map((c) => c.id) }, operation: { tenantId } },
        select: {
          yardContainerId: true,
          operation: {
            select: {
              createdAt: true,
              storageFreetimeDays: true,
              shipmentFile: { select: { id: true, voyageCode: true } },
            },
          },
        },
      }),
    ]);
    const clientById = new Map(clients.map((c) => [c.id, c]));
    // Opération la plus ancienne = celle qui a fait entrer le conteneur.
    const opByContainer = new Map<string, (typeof opLines)[number]['operation']>();
    for (const l of opLines) {
      const cur = opByContainer.get(l.yardContainerId!);
      if (!cur || l.operation.createdAt < cur.createdAt) opByContainer.set(l.yardContainerId!, l.operation);
    }
    const now = new Date();
    for (const c of containers) {
      const op = opByContainer.get(c.id);
      const client = c.clientId ? clientById.get(c.clientId) : undefined;
      const empty = c.containerType === 'EMPTY';
      let freetimeDays = DEFAULT_FREETIME;
      let source: ContainerFranchise['source'] = 'default';
      if (op?.storageFreetimeDays != null) {
        freetimeDays = op.storageFreetimeDays;
        source = 'dossier';
      } else if (client) {
        if (empty && client.emptyFreetimeDays != null) {
          freetimeDays = client.emptyFreetimeDays;
          source = 'client_empty';
        } else {
          freetimeDays = client.defaultFreetimeDays;
          source = 'client';
        }
      }
      // Conteneur sorti : séjour arrêté à la date de sortie réelle.
      const stayDays = c.gateInDate
        ? countStayDays(c.gateInDate, c.gateOutDate ?? now, rules.weekendsIncluded)
        : 0;
      const remaining = freetimeDays - stayDays;
      const state: FranchiseState = !c.gateInDate
        ? 'none'
        : remaining < 0
          ? 'over'
          : remaining === 0
            ? 'today'
            : remaining <= Math.max(2, rules.alertLeadDays)
              ? 'soon'
              : 'ok';
      out.set(c.id, {
        freetimeDays,
        stayDays,
        remaining,
        overDays: Math.max(0, -remaining),
        state,
        source,
        dossier: op?.shipmentFile ?? null,
      });
    }
    return out;
  }

  private startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Indicateurs du Parc conteneurs (bandeau KPI + « Aujourd'hui » + clients). */
  async parkStats(tenantId: string, yardId?: string) {
    const containers = await this.prisma.yardContainer.findMany({
      where: { tenantId, status: { in: IN_YARD }, ...(yardId ? { yardId } : {}) },
      select: {
        id: true,
        gateInDate: true,
        containerType: true,
        clientId: true,
        sizeFt: true,
        client: { select: { id: true, name: true } },
      },
    });
    const fr = await this.franchiseOf(tenantId, containers);
    const today = this.startOfToday();
    const [gateInToday, gateOutToday, depotages, slots, yard] = await Promise.all([
      this.prisma.yardMovement.count({
        where: {
          movementType: YardMovementType.GATE_IN,
          createdAt: { gte: today },
          container: { tenantId, ...(yardId ? { yardId } : {}) },
        },
      }),
      this.prisma.yardMovement.count({
        where: {
          movementType: YardMovementType.GATE_OUT,
          createdAt: { gte: today },
          container: { tenantId, ...(yardId ? { yardId } : {}) },
        },
      }),
      // Dépotages planifiés : opérations de dépotage dont au moins une unité
      // n'a pas encore été traitée.
      this.prisma.operation.count({
        where: {
          tenantId,
          type: { in: [OperationType.DEP_TRANS, OperationType.DEP_STOCK] },
          lines: { some: { done: false } },
          ...(yardId ? { shipmentFile: { defaultYardId: yardId } } : {}),
        },
      }),
      this.prisma.yardPosition.count({ where: { yard: { tenantId }, ...(yardId ? { yardId } : {}) } }),
      yardId
        ? this.prisma.yard.findFirst({ where: { id: yardId, tenantId }, select: { capacityEvp: true, name: true } })
        : null,
    ]);

    const evp = containers.reduce((s, c) => s + evpOf(c.sizeFt), 0);
    const states = containers.map((c) => fr.get(c.id)!);
    const placed = states.filter((s) => s.state !== 'none');
    const capacity = yard?.capacityEvp ?? slots;
    const byClient = new Map<string, { clientId: string | null; name: string; ct: number; evp: number; n20: number; n40: number; over: number }>();
    for (const c of containers) {
      const key = c.clientId ?? '__none__';
      const row = byClient.get(key) ?? { clientId: c.clientId, name: c.client?.name ?? 'Divers', ct: 0, evp: 0, n20: 0, n40: 0, over: 0 };
      row.ct++;
      row.evp += evpOf(c.sizeFt);
      if ((c.sizeFt ?? 20) >= 40) row.n40++;
      else row.n20++;
      if (fr.get(c.id)!.state === 'over') row.over++;
      byClient.set(key, row);
    }
    return {
      ct: containers.length,
      evp,
      inFranchise: states.filter((s) => s.state !== 'over').length,
      over: states.filter((s) => s.state === 'over').length,
      overDays: states.reduce((s, x) => s + x.overDays, 0),
      expiringSoon: states.filter((s) => s.state === 'soon' || s.state === 'today').length,
      occupancy: { evp, capacity, pct: capacity ? Math.round((evp / capacity) * 100) : 0, capacityFromPositions: !yard?.capacityEvp },
      today: {
        gateIn: gateInToday,
        gateOut: gateOutToday,
        depotagesPlanned: depotages,
        avgStayDays: placed.length ? Math.round((placed.reduce((s, x) => s + x.stayDays, 0) / placed.length) * 10) / 10 : 0,
      },
      byClient: [...byClient.values()].sort((a, b) => b.evp - a.evp),
    };
  }

  /** Synthèse d'un client : conteneurs en yard, franchise, mouvements, facturation, activité. */
  async clientOverview(tenantId: string, clientId: string) {
    const client = await this.prisma.tenant.findFirst({
      where: { id: clientId, type: 'CLIENT' },
      select: {
        id: true,
        name: true,
        isActive: true,
        defaultFreetimeDays: true,
        emptyFreetimeDays: true,
        defaultPaymentTerms: true,
        paymentDelayDays: true,
        currency: true,
        contractRef: true,
        contractOk: true,
        contractEndsAt: true,
        localAgent: true,
        tariffGridLabel: true,
        containerPrefixes: true,
        contacts: true,
        contact: true,
      },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    const since30 = new Date(Date.now() - 30 * DAY);
    const [containers, totalInYard, moves30, recentMoves, recentFiles, invoices] = await Promise.all([
      this.prisma.yardContainer.findMany({
        where: { tenantId, clientId, status: { in: IN_YARD } },
        select: {
          id: true,
          containerNumber: true,
          isoTypeCode: true,
          sizeFt: true,
          containerType: true,
          gateInDate: true,
          clientId: true,
          status: true,
          yardPosition: { select: { block: true, bay: true, row: true, tier: true } },
        },
        orderBy: { gateInDate: 'asc' },
      }),
      this.prisma.yardContainer.count({ where: { tenantId, status: { in: IN_YARD } } }),
      this.prisma.yardMovement.groupBy({
        by: ['movementType'],
        where: { createdAt: { gte: since30 }, container: { tenantId, clientId } },
        _count: { _all: true },
      }),
      this.prisma.yardMovement.findMany({
        where: {
          container: { tenantId, clientId },
          movementType: { in: [YardMovementType.GATE_IN, YardMovementType.GATE_OUT] },
        },
        select: {
          movementType: true,
          createdAt: true,
          container: { select: { containerNumber: true, containerType: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.shipmentFile.findMany({
        where: { tenantId, clientId },
        select: { id: true, voyageCode: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.prisma.invoice.findMany({
        where: { shipmentFile: { tenantId, clientId }, status: { not: InvoiceStatus.DRAFT } },
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          total: true,
          issuedAt: true,
          shipmentFile: { select: { payment: { select: { dueDate: true } } } },
        },
        orderBy: { issuedAt: 'desc' },
      }),
    ]);
    const fr = await this.franchiseOf(tenantId, containers);
    const rows = containers.map((c) => ({ ...c, franchise: fr.get(c.id)! }));
    const placed = rows.filter((r) => r.franchise.state !== 'none');
    const over = rows.filter((r) => r.franchise.state === 'over');
    const now = Date.now();
    const open = invoices.filter((i) => i.status === InvoiceStatus.ISSUED);
    const overdue = open.filter((i) => {
      const due = i.shipmentFile.payment?.dueDate;
      return due && due.getTime() < now;
    });
    const moveCount = (t: YardMovementType) => moves30.find((m) => m.movementType === t)?._count._all ?? 0;

    // Activité récente : mouvements Gate, dossiers créés, franchises dépassées.
    const activity = [
      ...recentMoves.map((m) => ({
        kind: m.movementType === YardMovementType.GATE_IN ? 'gate_in' : 'gate_out',
        label: `${m.movementType === YardMovementType.GATE_IN ? 'Gate-in' : 'Gate-out'} ${m.container.containerNumber}${m.container.containerType === 'EMPTY' ? ' (vide)' : ''}`,
        at: m.createdAt,
      })),
      ...recentFiles.map((f) => ({ kind: 'dossier', label: `Dossier ${f.voyageCode} créé`, at: f.createdAt })),
      ...over
        .filter((r) => r.gateInDate)
        .map((r) => ({
          kind: 'franchise',
          label: `Franchise dépassée : ${r.containerNumber}`,
          // Date de fin de franchise ≈ entrée + franchise.
          at: new Date(r.gateInDate!.getTime() + r.franchise.freetimeDays * DAY),
        })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6);

    return {
      client,
      kpis: {
        ct: rows.length,
        parkSharePct: totalInYard ? Math.round((rows.length / totalInYard) * 100) : 0,
        evp: rows.reduce((s, r) => s + evpOf(r.sizeFt), 0),
        n20: rows.filter((r) => (r.sizeFt ?? 20) < 40).length,
        n40: rows.filter((r) => (r.sizeFt ?? 20) >= 40 && (r.sizeFt ?? 20) < 45).length,
        nOther: rows.filter((r) => (r.sizeFt ?? 20) >= 45).length,
        inFranchise: rows.length - over.length,
        expiringSoon: rows.filter((r) => r.franchise.state === 'soon' || r.franchise.state === 'today').length,
        over: over.length,
        overDays: over.reduce((s, r) => s + r.franchise.overDays, 0),
        avgStayDays: placed.length ? Math.round((placed.reduce((s, r) => s + r.franchise.stayDays, 0) / placed.length) * 10) / 10 : 0,
        movements30: { in: moveCount(YardMovementType.GATE_IN), out: moveCount(YardMovementType.GATE_OUT) },
      },
      containers: rows.map((r) => ({
        id: r.id,
        containerNumber: r.containerNumber,
        isoTypeCode: r.isoTypeCode,
        sizeFt: r.sizeFt,
        empty: r.containerType === 'EMPTY',
        status: r.status,
        gateInDate: r.gateInDate,
        position: r.yardPosition,
        dossier: r.franchise.dossier,
        franchise: { ...r.franchise, dossier: undefined },
      })),
      billing: {
        unbilledOverCt: over.length,
        unbilledOverDays: over.reduce((s, r) => s + r.franchise.overDays, 0),
        openCount: open.length,
        openTotal: open.reduce((s, i) => s + (i.total ?? 0), 0),
        overdueTotal: overdue.reduce((s, i) => s + (i.total ?? 0), 0),
        lastInvoice: invoices[0] ? { invoiceNo: invoices[0].invoiceNo, issuedAt: invoices[0].issuedAt, total: invoices[0].total } : null,
      },
      activity,
    };
  }
}
