import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InducedRuleWhen } from '@prisma/client';
import { ResolveInducedServicesDto } from './dto/resolve-induced-services.dto';
import {
  AddManualServiceLineDto,
  UpdateServiceLineDto,
} from './dto/manual-service-line.dto';
import {
  DAILY_TO_MONTHLY_TARIFF_CODE,
  STAY_INDUCED_CODES,
  isMonthlyStayTier,
  normalizeStayEngine,
  stayMonthlyQuantity,
} from '../stay-engine/stay-engine';
import { resolveFromGrid } from './grid-resolver';
import { PreviewChargesDto } from './dto/preview-charges.dto';

// Codes de régime réels du référentiel StorageRegimeRef (voir prisma/seed.ts)
// — distincts des codes courts EF/MAD/LIBRE utilisés côté frontend prototype.
const REGIME_MAD = 'MAD';
const REGIME_EF = 'ENTREPOT_FICTIF';
const REGIME_LIBRE = 'WAREHOUSE_LIBRE';

// Dépotage/empotage résolu par taille + nature (règle §5 de la Note logique
// de service DMT Hub) — miroir de inducedForSizeNature() côté frontend
// (lib/data/data-dos.js).
const SIZE_NATURE_CODES: Record<
  string,
  Record<number, Record<string, string>>
> = {
  depotage: {
    20: { Vrac: 'IS-07', Conventionnel: 'IS-09' },
    40: { Vrac: 'IS-11', Conventionnel: 'IS-13' },
  },
  empotage: {
    20: { Vrac: 'IS-08', Conventionnel: 'IS-10' },
    40: { Vrac: 'IS-12', Conventionnel: 'IS-14' },
  },
};
const DEPOTAGE_OPS = ['DEP_TRANS', 'DEP_STOCK'];
const EMPOTAGE_OPS = ['EMP_EXPORT', 'LOAD_EXPORT'];
// Stockage dérivé automatiquement du régime douanier — ne doit jamais être
// ressaisi manuellement (règle §5). N'agit que sur les opérations qui
// portent un stockage générique.
const STORAGE_DERIVED_OPS = ['ICD_FULL', 'ICD_EMPTY', 'ENT_IN', 'DEP_STOCK'];

interface ResolvedLine {
  inducedServiceId: string | null;
  tariffId: string | null;
  label: string;
  unit: string;
  quantity: number;
  rate: number;
  mandatory: boolean;
  ruleLabel: string | null;
}

@Injectable()
export class InducedServicesService {
  constructor(private readonly prisma: PrismaService) {}

  private inducedForRegime(regimeCode: string | undefined): string {
    if (regimeCode === REGIME_EF) return 'IS-16';
    if (regimeCode === REGIME_MAD) return 'IS-15';
    return 'IS-17'; // WAREHOUSE_LIBRE ou tout autre régime non reconnu
  }

  // Évalue si une règle conditionnelle (§4 de la note) est satisfaite —
  // miroir de ruleSatisfied() côté frontend (lib/stores/dos-store.js).
  private ruleSatisfied(
    when: InducedRuleWhen | null,
    ctx: {
      regimeCode?: string;
      days: number;
      freetime: number;
      cargo: 'CT' | 'CV';
    },
  ): boolean {
    switch (when) {
      case InducedRuleWhen.ALWAYS:
        return true;
      case InducedRuleWhen.OVER_FRANCHISE:
        return ctx.days > ctx.freetime;
      case InducedRuleWhen.REGIME_MAD:
        return ctx.regimeCode === REGIME_MAD;
      case InducedRuleWhen.REGIME_SPECIAL:
        return ctx.regimeCode !== REGIME_EF && ctx.regimeCode !== REGIME_LIBRE;
      // Mode de sortie camion : pas encore de champ dédié côté dossier —
      // retenu par défaut (une ligne conditionnelle en trop se retire
      // facilement en mode Détaillé), même choix que côté frontend.
      case InducedRuleWhen.EXIT_TRUCK:
        return true;
      case InducedRuleWhen.STUFFED_CONTAINER:
        return ctx.cargo === 'CT';
      default:
        return false;
    }
  }

  async resolve(
    fileId: string,
    tenantId: string,
    dto: ResolveInducedServicesDto,
  ) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      include: {
        operations: {
          include: {
            lines: { include: { yardContainer: true, shipmentLine: true } },
            gatePasses: { select: { id: true } },
          },
        },
        lines: { select: { surfaceM2: true, weightKg: true, status: true } },
      },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    const days = dto.days ?? 0;
    const freetime = dto.freetime ?? 0;
    const tenantRules = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        stayMonthlyThresholdDays: true,
        stayAlertLeadDays: true,
        stayWeekendsIncluded: true,
      },
    });
    const stayEngine = normalizeStayEngine({
      monthlyThresholdDays: tenantRules?.stayMonthlyThresholdDays,
      alertLeadDays: tenantRules?.stayAlertLeadDays,
      weekendsIncluded: tenantRules?.stayWeekendsIncluded,
    });
    const monthlyTier = isMonthlyStayTier(
      days,
      stayEngine.monthlyThresholdDays,
    );
    const monthlyQty = stayMonthlyQuantity(days);
    const tariffs = await this.prisma.tariffRef.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        unit: true,
        rate: true,
        applicableOps: true,
        mandatory: true,
      },
    });
    const tariffByCode = new Map(tariffs.map((t) => [t.code, t]));
    const cargo: 'CT' | 'CV' = file.operations.some((o) =>
      o.lines.some((l) => l.yardContainerId),
    )
      ? 'CT'
      : 'CV';

    const inducedServices = await this.prisma.inducedServiceRef.findMany({
      where: { tenantId, isActive: true },
      include: { tariff: true },
    });
    const byId = new Map(inducedServices.map((s) => [s.id, s]));
    const byCode = new Map(inducedServices.map((s) => [s.code, s]));

    const resolved = new Map<string, ResolvedLine>();
    const push = (
      serviceId: string,
      quantity: number,
      opts: { mandatory: boolean; ruleLabel?: string | null },
    ) => {
      if (resolved.has(serviceId) || !(quantity > 0)) return;
      const svc = byId.get(serviceId);
      if (!svc) return;
      const monthlyTf =
        monthlyTier && STAY_INDUCED_CODES.has(svc.code) && svc.tariff?.code
          ? tariffByCode.get(DAILY_TO_MONTHLY_TARIFF_CODE[svc.tariff.code])
          : undefined;
      const tf = monthlyTf ?? svc.tariff;
      resolved.set(serviceId, {
        inducedServiceId: svc.id,
        tariffId: tf?.id ?? svc.tariffId,
        label: monthlyTf?.label ?? svc.label,
        unit: tf?.unit ?? '—',
        quantity: Math.round(quantity * 100) / 100,
        rate: tf?.rate ?? 0,
        mandatory: opts.mandatory,
        ruleLabel: opts.ruleLabel ?? null,
      });
    };

    // Quantité par défaut d'une prestation induite, faute d'unité propre
    // dans la note — miroir de qtyFor() côté frontend (lib/stores/dos-store.js).
    const containerLines = file.operations.flatMap((o) =>
      o.lines.filter((l) => l.yardContainerId && l.yardContainer),
    );
    const n20 = containerLines.filter(
      (l) => l.yardContainer!.sizeFt === 20,
    ).length;
    const containerCount = containerLines.length || 1;
    // Grille 2026 : un 20' = 1 EVP, un 40' (et plus) = 2 EVP.
    const evp =
      containerLines.reduce(
        (sum, l) => sum + ((l.yardContainer!.sizeFt ?? 20) >= 40 ? 2 : 1),
        0,
      ) || containerCount;
    const totalWeightKg = containerLines.reduce(
      (a, l) => a + (l.yardContainer!.grossWeightKg ?? 0),
      0,
    );

    const qtyFor = (code: string): number => {
      switch (code) {
        case 'IS-05':
          return evp;
        case 'IS-06':
          return (
            (monthlyTier ? monthlyQty : Math.max(0, days - freetime)) * evp
          );
        case 'IS-15':
        case 'IS-16':
          return n20 * (monthlyTier ? monthlyQty : days || 1);
        case 'IS-17':
          return monthlyTier ? monthlyQty : days || 1;
        case 'IS-18':
        case 'IS-19':
        case 'IS-20':
        case 'IS-21':
          return Math.max(0.1, totalWeightKg / 1000);
        case 'IS-23':
          return Math.max(0, dto.pickupWaitDays ?? 0);
        case 'IS-01':
        case 'IS-02':
        case 'IS-03':
        case 'IS-04':
          return containerCount;
        default:
          return containerCount;
      }
    };

    const rules = await this.prisma.operationInducedRule.findMany({
      where: {
        tenantId,
        isActive: true,
        operationType: { in: file.operations.map((o) => o.type) },
      },
    });

    const ruleCtx = {
      regimeCode: file.storageRegimeCode,
      days,
      freetime,
      cargo,
    };

    for (const operation of file.operations) {
      const opRules = rules.filter((r) => r.operationType === operation.type);
      for (const rule of opRules) {
        const svc = byId.get(rule.inducedServiceId);
        if (!svc) continue;
        if (rule.mandatory) {
          push(svc.id, qtyFor(svc.code), { mandatory: true });
        } else if (this.ruleSatisfied(rule.when, ruleCtx)) {
          push(svc.id, qtyFor(svc.code), {
            mandatory: false,
            ruleLabel: rule.when,
          });
        }
      }

      // Stockage dérivé automatiquement du régime douanier (règle §5) —
      // ne remplace le stockage générique que pour les opérations qui en portent un.
      if (STORAGE_DERIVED_OPS.includes(operation.type)) {
        const derivedCode = this.inducedForRegime(file.storageRegimeCode);
        const derived = byCode.get(derivedCode);
        if (derived)
          push(derived.id, qtyFor(derivedCode), {
            mandatory: true,
            ruleLabel: 'REGIME_DERIVED',
          });
      }

      // Dépotage/Empotage : résolu par taille + nature de chaque conteneur
      // (règle §5 — 4 combinaisons non interchangeables).
      if (
        DEPOTAGE_OPS.includes(operation.type) ||
        EMPOTAGE_OPS.includes(operation.type)
      ) {
        const kind = DEPOTAGE_OPS.includes(operation.type)
          ? 'depotage'
          : 'empotage';
        const bySizeNature = new Map<string, number>();
        for (const line of operation.lines) {
          if (!line.yardContainer || !line.cargoNature) continue;
          const code =
            SIZE_NATURE_CODES[kind]?.[line.yardContainer.sizeFt]?.[
              line.cargoNature
            ];
          if (!code) continue;
          bySizeNature.set(code, (bySizeNature.get(code) ?? 0) + 1);
        }
        for (const [code, qty] of bySizeNature) {
          const svc = byCode.get(code);
          if (svc)
            push(svc.id, qty, { mandatory: true, ruleLabel: 'SIZE_NATURE' });
        }
      }
    }

    const pickupWaitDays = dto.pickupWaitDays ?? 0;
    if (pickupWaitDays > 0) {
      const detention = byCode.get('IS-23');
      if (detention) {
        push(detention.id, pickupWaitDays, {
          mandatory: true,
          ruleLabel: 'PICKUP_WAIT',
        });
      }
    }

    // Charges de la grille tarifaire : tout tarif « Obligatoire » applicable
    // à une opération du dossier (voir grid-resolver.ts). Un tarif déjà
    // présent (règle ci-dessus ou ligne ajoutée à la main) n'est pas doublé.
    const manualTariffIds = new Set(
      (
        await this.prisma.shipmentFileServiceLine.findMany({
          where: { shipmentFileId: fileId, tenantId, mandatory: null },
          select: { tariffId: true },
        })
      )
        .map((l) => l.tariffId)
        .filter(Boolean),
    );
    const takenTariffIds = new Set(
      [...resolved.values()].map((l) => l.tariffId).filter(Boolean),
    );
    const seenContainers = new Set<string>();
    const containers = file.operations
      .flatMap((o) => o.lines)
      .filter((l) => {
        if (!l.yardContainerId || !l.yardContainer) return false;
        if (seenContainers.has(l.yardContainerId)) return false;
        seenContainers.add(l.yardContainerId);
        return true;
      })
      .map((l) => ({
        sizeFt: l.yardContainer!.sizeFt,
        containerType: l.yardContainer!.containerType,
      }));
    const reservedSurface = Math.max(
      0,
      ...file.operations.flatMap((o) =>
        o.lines.map(
          (l) => Number((l.slot as { surfaceM2?: number } | null)?.surfaceM2) || 0,
        ),
      ),
    );
    const linesSurface = file.lines.reduce((s, l) => s + (l.surfaceM2 ?? 0), 0);
    const gridLines = resolveFromGrid(tariffs, {
      operationTypes: [...new Set(file.operations.map((o) => o.type))],
      containers,
      regimeCode: file.storageRegimeCode,
      days,
      freetime,
      monthlyTier,
      monthlyQty,
      truckCount: file.operations.reduce((s, o) => s + o.gatePasses.length, 0),
      surfaceM2: linesSurface || reservedSurface,
      weightKg:
        totalWeightKg + file.lines.reduce((s, l) => s + (l.weightKg ?? 0), 0),
      pickupWaitDays: dto.pickupWaitDays ?? 0,
    });
    for (const g of gridLines) {
      if (takenTariffIds.has(g.tariffId) || manualTariffIds.has(g.tariffId))
        continue;
      // Une prestation du catalogue sans tarif (ligne à 0 FCFA, ex. détention
      // camion IS-23) est remplacée par le tarif de la grille du même nom.
      for (const [key, l] of resolved) {
        if (!l.tariffId && l.label.toLowerCase() === g.label.toLowerCase())
          resolved.delete(key);
      }
      resolved.set(`grid:${g.tariffId}`, {
        inducedServiceId: null,
        tariffId: g.tariffId,
        label: g.label,
        unit: g.unit,
        quantity: g.quantity,
        rate: g.rate,
        mandatory: true,
        ruleLabel: g.ruleLabel,
      });
    }

    const lines = [...resolved.values()];

    // Remplace les lignes précédemment générées automatiquement (mandatory
    // non null) ; conserve les lignes manuelles (mandatory null) ajoutées
    // depuis la grille tarifaire ou "Autre".
    await this.prisma.$transaction([
      this.prisma.shipmentFileServiceLine.deleteMany({
        where: { shipmentFileId: fileId, tenantId, mandatory: { not: null } },
      }),
      this.prisma.shipmentFileServiceLine.createMany({
        data: lines.map((l) => ({
          shipmentFileId: fileId,
          tenantId,
          inducedServiceId: l.inducedServiceId,
          tariffId: l.tariffId,
          label: l.label,
          unit: l.unit,
          quantity: l.quantity,
          rate: l.rate,
          mandatory: l.mandatory,
          ruleLabel: l.ruleLabel,
        })),
      }),
    ]);

    return this.prisma.shipmentFileServiceLine.findMany({
      where: { shipmentFileId: fileId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Aperçu (sans persistance) des charges de la grille pour le wizard. */
  async preview(tenantId: string, dto: PreviewChargesDto) {
    const days = dto.days ?? 0;
    const tenantRules = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stayMonthlyThresholdDays: true },
    });
    const stayEngine = normalizeStayEngine({
      monthlyThresholdDays: tenantRules?.stayMonthlyThresholdDays,
    });
    const tariffs = await this.prisma.tariffRef.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        label: true,
        unit: true,
        rate: true,
        applicableOps: true,
        mandatory: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    const containers = (dto.containers ?? []).map((c) => ({
      sizeFt: c.sizeFt ?? 20,
      containerType: c.containerType ?? 'DRY',
    }));
    return resolveFromGrid(tariffs, {
      operationTypes: dto.operationTypes,
      containers,
      regimeCode: dto.regimeCode,
      days,
      freetime: dto.freetime ?? 0,
      monthlyTier: isMonthlyStayTier(days, stayEngine.monthlyThresholdDays),
      monthlyQty: stayMonthlyQuantity(days),
      truckCount: 1,
      surfaceM2: dto.surfaceM2 ?? 0,
      weightKg:
        dto.weightKg ??
        (dto.containers ?? []).reduce((s, c) => s + (c.grossWeightKg ?? 0), 0),
      pickupWaitDays: 0,
    }).map((l) => ({ ...l, mandatory: true }));
  }

  async findByFile(fileId: string, tenantId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    return this.prisma.shipmentFileServiceLine.findMany({
      where: { shipmentFileId: fileId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Lignes manuelles (au-delà des prestations induites) ──────────────────
  // Miroir de addService()/removeFinanceLine()/updateFinanceLine() côté
  // frontend (dos-store.js) — mandatory=null les distingue des lignes
  // résolues automatiquement (voir resolve() ci-dessus).

  async addManualLine(
    fileId: string,
    tenantId: string,
    dto: AddManualServiceLineDto,
  ) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    // displayMandatory (PAS mandatory, qui doit rester null ici — voir son
    // commentaire dans schema.prisma) dérivé de TariffRef.mandatory quand la
    // ligne vient de la grille (tariffId fourni) : sert de valeur par
    // défaut purement informative pour l'affichage obligatoire/optionnel
    // sur la facture (voir décision explicite) ; reste null pour une
    // saisie "hors grille" sans TariffRef.
    let displayMandatory: boolean | null = null;
    if (dto.tariffId) {
      const tariff = await this.prisma.tariffRef.findFirst({
        where: { id: dto.tariffId, tenantId },
        select: { mandatory: true },
      });
      displayMandatory = tariff?.mandatory ?? null;
    }

    return this.prisma.shipmentFileServiceLine.create({
      data: {
        shipmentFileId: fileId,
        tenantId,
        label: dto.label,
        unit: dto.unit ?? 'unité',
        quantity: dto.quantity ?? 1,
        rate: dto.rate,
        tariffId: dto.tariffId,
        mandatory: null,
        displayMandatory,
      },
    });
  }

  async updateLine(
    fileId: string,
    tenantId: string,
    lineId: string,
    dto: UpdateServiceLineDto,
  ) {
    const line = await this.prisma.shipmentFileServiceLine.findFirst({
      where: { id: lineId, shipmentFileId: fileId, tenantId },
    });
    if (!line) throw new NotFoundException('Ligne de facturation introuvable.');

    return this.prisma.shipmentFileServiceLine.update({
      where: { id: lineId },
      data: {
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
      },
    });
  }

  async removeLine(fileId: string, tenantId: string, lineId: string) {
    const line = await this.prisma.shipmentFileServiceLine.findFirst({
      where: { id: lineId, shipmentFileId: fileId, tenantId },
    });
    if (!line) throw new NotFoundException('Ligne de facturation introuvable.');
    if (line.mandatory === true)
      throw new BadRequestException(
        'Impossible de retirer une prestation obligatoire — elle est requise par les opérations du dossier.',
      );

    await this.prisma.shipmentFileServiceLine.delete({ where: { id: lineId } });
    return { ok: true };
  }
}
