import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ContainerType,
  TransportMode,
  Prisma,
  YardContainerStatus,
} from '@prisma/client';
import { sizeForType, sizeFromIsoCode, familyFromIsoCode } from '../common/container-iso';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingLineRefDto } from './dto/create-shipping-line-ref.dto';
import { CreateContainerTypeRefDto } from './dto/create-container-type-ref.dto';
import {
  CreateYardBlockDefDto,
  UpdateYardBlockDefDto,
} from './dto/create-yard-block-def.dto';
import { UpdatePreGateDto } from './dto/update-pregate.dto';
import { PaymentTermDto } from '../payments/dto/payment-term.dto';
import { PaymentsService } from '../payments/payments.service';
import { releaseAbandonedYardPositions } from './yms.service';
import { normalizePlaceCode } from '../referentiels/referentiels.service';

interface PreGateLineInput {
  containerNumber: string;
  isoTypeCode?: string;
  sizeFt?: number;
  containerType?: ContainerType;
  grossWeightKg?: number;
  sealNumber?: string;
  shippingLine?: string;
  isDangerousGoods?: boolean;
  customsHold?: boolean;
  notes?: string;
}

interface CreatePreGateDto {
  yardId: string;
  clientId?: string;
  voyageCode: string;
  vesselName?: string;
  eta?: string;
  shippingLine?: string;
  transportMode?: TransportMode;
  notes?: string;
  paymentTerm?: PaymentTermDto;
  lines?: PreGateLineInput[];
}

function toSlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
}

@Injectable()
export class YmsReferentielsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // ── Armateurs ────────────────────────────────────────────────────────────

  async listShippingLines(tenantId: string) {
    return this.prisma.shippingLineRef.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async createShippingLine(tenantId: string, dto: CreateShippingLineRefDto) {
    const base = dto.code ? dto.code.toUpperCase() : toSlug(dto.label);
    let code = base;
    let suffix = 1;
    while (
      await this.prisma.shippingLineRef.findUnique({
        where: { tenantId_code: { tenantId, code } },
      })
    ) {
      code = `${base}-${suffix++}`;
    }
    const { label, scac, isActive, sortOrder } = dto;
    return this.prisma.shippingLineRef.create({
      data: { tenantId, label, scac, isActive, sortOrder, code },
    });
  }

  async updateShippingLine(
    tenantId: string,
    id: string,
    dto: Partial<CreateShippingLineRefDto>,
  ) {
    const ref = await this.prisma.shippingLineRef.findFirst({
      where: { id, tenantId },
    });
    if (!ref) throw new NotFoundException('Armateur introuvable.');
    return this.prisma.shippingLineRef.update({ where: { id }, data: dto });
  }

  async deleteShippingLine(tenantId: string, id: string) {
    const ref = await this.prisma.shippingLineRef.findFirst({
      where: { id, tenantId },
    });
    if (!ref) throw new NotFoundException('Armateur introuvable.');
    await this.prisma.shippingLineRef.delete({ where: { id } });
    return { ok: true };
  }

  // ── Types conteneurs ─────────────────────────────────────────────────────

  async listContainerTypes(tenantId: string) {
    return this.prisma.containerTypeRef.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async createContainerType(tenantId: string, dto: CreateContainerTypeRefDto) {
    const base = dto.code ? dto.code.toUpperCase() : toSlug(dto.label);
    let code = base;
    let suffix = 1;
    while (
      await this.prisma.containerTypeRef.findUnique({
        where: { tenantId_code: { tenantId, code } },
      })
    ) {
      code = `${base}-${suffix++}`;
    }
    const { label, isoPrefix, sizeFt, family, isActive, sortOrder } = dto;
    return this.prisma.containerTypeRef.create({
      data: {
        tenantId,
        label,
        isoPrefix,
        // Type créé à la volée avec son seul code (ex. « 40DV ») : taille et
        // famille déduites du code ISO plutôt que le défaut 20' / dry.
        sizeFt: sizeFt ?? sizeFromIsoCode(code) ?? undefined,
        family: family ?? familyFromIsoCode(code) ?? undefined,
        isActive,
        sortOrder,
        code,
      },
    });
  }

  async updateContainerType(
    tenantId: string,
    id: string,
    dto: Partial<CreateContainerTypeRefDto>,
  ) {
    const ref = await this.prisma.containerTypeRef.findFirst({
      where: { id, tenantId },
    });
    if (!ref) throw new NotFoundException('Type conteneur introuvable.');
    return this.prisma.containerTypeRef.update({ where: { id }, data: dto });
  }

  async deleteContainerType(tenantId: string, id: string) {
    const ref = await this.prisma.containerTypeRef.findFirst({
      where: { id, tenantId },
    });
    if (!ref) throw new NotFoundException('Type conteneur introuvable.');
    await this.prisma.containerTypeRef.delete({ where: { id } });
    return { ok: true };
  }

  // ── Blocs / YardBlockDef ─────────────────────────────────────────────────

  async listBlockDefs(tenantId: string, yardId?: string) {
    await releaseAbandonedYardPositions(this.prisma, tenantId);
    const defs = await this.prisma.yardBlockDef.findMany({
      where: { tenantId, ...(yardId ? { yardId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    // Agréger total/occupé/dimensions réelles depuis yard_positions pour
    // chaque bloc — rows/bays/tiers ne sont pas stockés sur YardBlockDef,
    // seulement déductibles des positions déjà générées (nécessaire pour
    // permettre l'agrandissement : on doit connaître la taille actuelle).
    const results = await Promise.all(
      defs.map(async (def) => {
        const [total, occupied, agg] = await Promise.all([
          this.prisma.yardPosition.count({ where: { yardBlockDefId: def.id } }),
          this.prisma.yardPosition.count({
            where: { yardBlockDefId: def.id, isOccupied: true },
          }),
          this.prisma.yardPosition.aggregate({
            where: { yardBlockDefId: def.id },
            _max: { bay: true, row: true, tier: true },
          }),
        ]);
        return {
          ...def,
          total,
          occupied,
          bays: agg._max.bay ?? 0,
          rows: agg._max.row ?? 0,
          tiers: agg._max.tier ?? def.maxTier,
        };
      }),
    );

    // Positions orphelines (block A–E en yard_positions sans YardBlockDef)
    // — le moteur de réservation peut les utiliser alors que l'écran de
    // configuration afficherait 0 blocs. On les expose pour rester aligné.
    const covered = new Set(defs.map((d) => `${d.yardId}:${d.code}`));
    const orphans = await this.prisma.yardPosition.groupBy({
      by: ['yardId', 'block'],
      where: {
        yard: { tenantId },
        ...(yardId ? { yardId } : {}),
        yardBlockDefId: null,
      },
      _count: { _all: true },
      _max: { bay: true, row: true, tier: true },
    });
    for (const g of orphans) {
      const key = `${g.yardId}:${g.block}`;
      if (covered.has(key)) continue;
      const occupied = await this.prisma.yardPosition.count({
        where: {
          yardId: g.yardId,
          block: g.block,
          isOccupied: true,
        },
      });
      results.push({
        id: `pos:${g.yardId}:${g.block}`,
        tenantId,
        yardId: g.yardId,
        code: g.block,
        label: g.block,
        maxTier: g._max.tier ?? 3,
        allowDangerousGoods: false,
        allowReefer: false,
        allowEmpty: true,
        allowAllTypes: true,
        isActive: true,
        sortOrder: 99,
        polygon: null,
        createdAt: new Date(),
        total: g._count._all,
        occupied,
        bays: g._max.bay ?? 0,
        rows: g._max.row ?? 0,
        tiers: g._max.tier ?? 3,
      });
    }
    return results;
  }

  async createBlockDef(tenantId: string, dto: CreateYardBlockDefDto) {
    // Vérifie que le yard appartient au tenant
    const yard = await this.prisma.yard.findFirst({
      where: { id: dto.yardId, tenantId },
    });
    if (!yard) throw new NotFoundException('Yard introuvable.');

    // Vérifie unicité code dans ce yard
    const code = normalizePlaceCode(dto.code);
    const existing = await this.prisma.yardBlockDef.findUnique({
      where: {
        yardId_code: { yardId: dto.yardId, code },
      },
    });
    if (existing)
      throw new ConflictException(
        `Le bloc "${code}" existe déjà dans ce yard.`,
      );
    const maxTier = dto.maxTier ?? dto.tiers;

    // Crée le YardBlockDef + génère toutes les positions dans une transaction
    const blockDef = await this.prisma.$transaction(async (tx) => {
      const def = await tx.yardBlockDef.create({
        data: {
          tenantId,
          yardId: dto.yardId,
          code,
          label: dto.label,
          maxTier,
          allowDangerousGoods: dto.allowDangerousGoods ?? false,
          allowReefer: dto.allowReefer ?? false,
          allowEmpty: dto.allowEmpty ?? true,
          allowAllTypes: dto.allowAllTypes ?? true,
          sortOrder: dto.sortOrder ?? 0,
          polygon: dto.polygon as unknown as Prisma.InputJsonValue,
        },
      });

      // Génère bays × rows × tiers positions
      const positions: {
        yardId: string;
        block: string;
        yardBlockDefId: string;
        bay: number;
        row: number;
        tier: number;
        maxTier: number;
      }[] = [];
      for (let bay = 1; bay <= dto.bays; bay++) {
        for (let row = 1; row <= dto.rows; row++) {
          for (let tier = 1; tier <= dto.tiers; tier++) {
            positions.push({
              yardId: dto.yardId,
              block: code,
              yardBlockDefId: def.id,
              bay,
              row,
              tier,
              maxTier,
            });
          }
        }
      }
      await tx.yardPosition.createMany({ data: positions });

      return def;
    });

    const positionsCreated = dto.bays * dto.rows * dto.tiers;
    return { ok: true, blockDef, positionsCreated };
  }

  private async renameBlockCode(
    tx: Prisma.TransactionClient,
    def: { id: string; yardId: string; code: string },
    code: string,
  ) {
    if (code === def.code) return;
    const clash = await tx.yardBlockDef.findFirst({
      where: { yardId: def.yardId, code, id: { not: def.id } },
    });
    if (clash)
      throw new ConflictException(
        `Le code ${code} est déjà utilisé par un autre bloc de ce dépôt.`,
      );
    const positionClash = await tx.yardPosition.findFirst({
      where: {
        yardId: def.yardId,
        block: code,
        OR: [{ yardBlockDefId: null }, { yardBlockDefId: { not: def.id } }],
      },
    });
    if (positionClash)
      throw new ConflictException(
        `Le code ${code} est déjà utilisé par des emplacements de ce dépôt.`,
      );
    await tx.yardPosition.updateMany({
      where: { yardBlockDefId: def.id },
      data: { block: code },
    });
    const stored = await tx.operationLine.findMany({
      where: {
        slot: { not: Prisma.DbNull },
        operation: { shipmentFile: { defaultYardId: def.yardId } },
      },
      select: { id: true, slot: true },
    });
    for (const line of stored) {
      const current = line.slot as { block?: string } | null;
      if (!current || current.block !== def.code) continue;
      if (!line.slot || typeof line.slot !== 'object' || Array.isArray(line.slot))
        continue;
      await tx.operationLine.update({
        where: { id: line.id },
        data: { slot: { ...(line.slot as Prisma.JsonObject), block: code } },
      });
    }
  }

  async updateBlockDef(
    tenantId: string,
    id: string,
    dto: UpdateYardBlockDefDto,
  ) {
    const def = await this.prisma.yardBlockDef.findFirst({
      where: { id, tenantId },
    });
    if (!def) throw new NotFoundException('Bloc introuvable.');

    const renamedCode =
      dto.code !== undefined && dto.code.trim() !== def.code
        ? normalizePlaceCode(dto.code)
        : undefined;

    const wantsResize =
      dto.bays !== undefined || dto.rows !== undefined || dto.tiers !== undefined;
    const polygonPatch =
      dto.polygon !== undefined
        ? { polygon: dto.polygon as unknown as Prisma.InputJsonValue }
        : {};

    if (!wantsResize) {
      const data = {
        ...(renamedCode ? { code: renamedCode } : {}),
        label: dto.label,
        allowDangerousGoods: dto.allowDangerousGoods,
        allowReefer: dto.allowReefer,
        allowEmpty: dto.allowEmpty,
        allowAllTypes: dto.allowAllTypes,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        ...polygonPatch,
      };
      if (!renamedCode) {
        return this.prisma.yardBlockDef.update({ where: { id }, data });
      }
      return this.prisma.$transaction(async (tx) => {
        await this.renameBlockCode(tx, def, renamedCode);
        return tx.yardBlockDef.update({ where: { id }, data });
      });
    }

    // Les places encore marquées occupées alors que le conteneur est parti
    // ne doivent pas bloquer une réduction.
    await releaseAbandonedYardPositions(this.prisma, tenantId);

    const agg = await this.prisma.yardPosition.aggregate({
      where: { yardBlockDefId: id },
      _max: { bay: true, row: true, tier: true },
    });
    const currentBays = agg._max.bay ?? 0;
    const currentRows = agg._max.row ?? 0;
    const currentTiers = agg._max.tier ?? def.maxTier;

    const newBays = dto.bays ?? currentBays;
    const newRows = dto.rows ?? currentRows;
    const newTiers = dto.tiers ?? currentTiers;
    const shrinking =
      newBays < currentBays || newRows < currentRows || newTiers < currentTiers;
    const newMaxTier =
      dto.tiers !== undefined && newTiers < def.maxTier
        ? newTiers
        : Math.max(def.maxTier, newTiers);

    return this.prisma.$transaction(async (tx) => {
      if (renamedCode) await this.renameBlockCode(tx, def, renamedCode);
      if (shrinking) {
        const outside = {
          yardBlockDefId: id,
          OR: [
            { bay: { gt: newBays } },
            { row: { gt: newRows } },
            { tier: { gt: newTiers } },
          ],
        };
        const stillHeld = {
          ...outside,
          containers: {
            some: { status: { not: YardContainerStatus.DEPARTED } },
          },
        };
        const blockingCount = await tx.yardPosition.count({ where: stillHeld });
        if (blockingCount) {
          const sample = await tx.yardPosition.findMany({
            where: stillHeld,
            select: { block: true, bay: true, row: true, tier: true },
            take: 5,
          });
          const where = sample
            .map((p) => `${p.block}-B${p.bay}-R${p.row}-T${p.tier}`)
            .join(', ');
          throw new BadRequestException(
            `Impossible de réduire : ${blockingCount} emplacement(s) encore occupé(s) (${where}). Sortez ou déplacez ces conteneurs d'abord.`,
          );
        }
        const doomed = await tx.yardPosition.findMany({
          where: outside,
          select: { id: true },
        });
        const doomedIds = doomed.map((p) => p.id);
        if (doomedIds.length) {
          await tx.yardContainer.updateMany({
            where: { yardPositionId: { in: doomedIds } },
            data: { yardPositionId: null },
          });
          await tx.yardMovement.updateMany({
            where: { fromPositionId: { in: doomedIds } },
            data: { fromPositionId: null },
          });
          await tx.yardMovement.updateMany({
            where: { toPositionId: { in: doomedIds } },
            data: { toPositionId: null },
          });
          await tx.yardPosition.deleteMany({ where: { id: { in: doomedIds } } });
        }
      }

      const toCreate: {
        yardId: string;
        block: string;
        yardBlockDefId: string;
        bay: number;
        row: number;
        tier: number;
        maxTier: number;
      }[] = [];
      for (let bay = 1; bay <= newBays; bay++) {
        for (let row = 1; row <= newRows; row++) {
          for (let tier = 1; tier <= newTiers; tier++) {
            if (bay <= currentBays && row <= currentRows && tier <= currentTiers)
              continue;
            toCreate.push({
              yardId: def.yardId,
              block: def.code,
              yardBlockDefId: id,
              bay,
              row,
              tier,
              maxTier: newMaxTier,
            });
          }
        }
      }
      if (toCreate.length > 0) {
        await tx.yardPosition.createMany({ data: toCreate });
      }
      if (newMaxTier !== def.maxTier) {
        await tx.yardPosition.updateMany({
          where: { yardBlockDefId: id },
          data: { maxTier: newMaxTier },
        });
      }

      return tx.yardBlockDef.update({
        where: { id },
        data: {
          ...(renamedCode ? { code: renamedCode } : {}),
          label: dto.label,
          maxTier: newMaxTier,
          allowDangerousGoods: dto.allowDangerousGoods,
          allowReefer: dto.allowReefer,
          allowEmpty: dto.allowEmpty,
          allowAllTypes: dto.allowAllTypes,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
          ...polygonPatch,
        },
      });
    });
  }

  async deleteBlockDef(tenantId: string, id: string) {
    const def = await this.prisma.yardBlockDef.findFirst({
      where: { id, tenantId },
    });
    if (!def) throw new NotFoundException('Bloc introuvable.');

    // Refuse si des positions sont occupées
    const occupied = await this.prisma.yardPosition.findFirst({
      where: { yardBlockDefId: id, isOccupied: true },
    });
    if (occupied)
      throw new ConflictException(
        'Impossible de supprimer un bloc avec des conteneurs en cours.',
      );

    // Supprime les positions puis le bloc
    const { count } = await this.prisma.yardPosition.deleteMany({
      where: { yardBlockDefId: id },
    });
    await this.prisma.yardBlockDef.delete({ where: { id } });

    return { ok: true, deletedPositions: count };
  }

  // ── Pré-gates ─────────────────────────────────────────────────────────────

  async listPreGates(tenantId: string, yardId?: string) {
    return this.prisma.preGate.findMany({
      where: { tenantId, ...(yardId ? { yardId } : {}) },
      include: {
        yard: { select: { id: true, code: true, name: true } },
        client: { select: { id: true, name: true } },
        payment: {
          select: {
            id: true,
            termType: true,
            status: true,
            dueDate: true,
            validatedAt: true,
            validatedById: true,
          },
        },
        lines: {
          select: {
            id: true,
            containerNumber: true,
            status: true,
            containerType: true,
            isoTypeCode: true,
            shippingLine: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPreGate(tenantId: string, id: string) {
    const pg = await this.prisma.preGate.findFirst({
      where: { id, tenantId },
      include: {
        yard: true,
        client: { select: { id: true, name: true } },
        payment: true,
        lines: true,
      },
    });
    if (!pg) throw new NotFoundException('Pré-gate introuvable.');
    return pg;
  }

  async createPreGate(tenantId: string, dto: CreatePreGateDto) {
    const { lines, paymentTerm, ...header } = dto;
    const payment = paymentTerm
      ? await this.paymentsService.createPayment(tenantId, paymentTerm)
      : null;

    return this.prisma.preGate.create({
      data: {
        tenantId,
        clientId: header.clientId,
        yardId: header.yardId,
        voyageCode: header.voyageCode,
        vesselName: header.vesselName,
        eta: header.eta ? new Date(header.eta) : undefined,
        shippingLine: header.shippingLine,
        transportMode: header.transportMode ?? 'SEA',
        notes: header.notes,
        ...(payment ? { paymentId: payment.id } : {}),
        lines: {
          create: (lines ?? []).map((l: PreGateLineInput) => ({
            containerNumber: l.containerNumber.toUpperCase(),
            isoTypeCode: l.isoTypeCode ?? '20DC',
            sizeFt: sizeForType(l.isoTypeCode, l.sizeFt),
            containerType: l.containerType ?? 'DRY',
            grossWeightKg: l.grossWeightKg,
            sealNumber: l.sealNumber,
            shippingLine: l.shippingLine ?? header.shippingLine,
            isDangerousGoods: l.isDangerousGoods ?? false,
            customsHold: l.customsHold ?? false,
            notes: l.notes,
          })),
        },
      },
      include: { lines: true, payment: true },
    });
  }

  async closePreGate(tenantId: string, id: string) {
    const pg = await this.prisma.preGate.findFirst({ where: { id, tenantId } });
    if (!pg) throw new NotFoundException('Pré-gate introuvable.');
    return this.prisma.preGate.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
  }

  async updatePreGate(tenantId: string, id: string, dto: UpdatePreGateDto) {
    const pg = await this.prisma.preGate.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!pg) throw new NotFoundException('Pré-gate introuvable.');

    const hasArrivedLine = pg.lines.some((l) => l.status !== 'EXPECTED');
    if (hasArrivedLine) {
      throw new ConflictException(
        'Ce pré-gate a déjà des conteneurs réceptionnés — modification impossible.',
      );
    }

    const { lines, ...header } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        const keptIds = lines.filter((l) => l.id).map((l) => l.id as string);
        // Supprime les lignes retirées du formulaire (toutes EXPECTED, vérifié ci-dessus)
        await tx.preGateLine.deleteMany({
          where: { preGateId: id, id: { notIn: keptIds } },
        });
        for (const l of lines) {
          const data = {
            containerNumber: l.containerNumber.toUpperCase(),
            isoTypeCode: l.isoTypeCode ?? '20DC',
            sizeFt: sizeForType(l.isoTypeCode, l.sizeFt),
            containerType: l.containerType ?? 'DRY',
            grossWeightKg: l.grossWeightKg,
            sealNumber: l.sealNumber,
            shippingLine: l.shippingLine ?? header.shippingLine,
            isDangerousGoods: l.isDangerousGoods ?? false,
            customsHold: l.customsHold ?? false,
            notes: l.notes,
          } as const;
          if (l.id) {
            await tx.preGateLine.update({ where: { id: l.id }, data });
          } else {
            await tx.preGateLine.create({ data: { ...data, preGateId: id } });
          }
        }
      }

      return tx.preGate.update({
        where: { id },
        data: {
          clientId: header.clientId,
          voyageCode: header.voyageCode,
          vesselName: header.vesselName,
          eta: header.eta ? new Date(header.eta) : undefined,
          shippingLine: header.shippingLine,
          transportMode: header.transportMode,
          notes: header.notes,
        },
        include: { lines: true },
      });
    });
  }

  async deletePreGate(tenantId: string, id: string) {
    const pg = await this.prisma.preGate.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!pg) throw new NotFoundException('Pré-gate introuvable.');

    const hasArrivedLine = pg.lines.some((l) => l.status !== 'EXPECTED');
    if (hasArrivedLine) {
      throw new ConflictException(
        'Ce pré-gate a déjà des conteneurs réceptionnés — suppression impossible.',
      );
    }

    await this.prisma.preGate.delete({ where: { id } });
    return { ok: true };
  }

  async scanContainer(tenantId: string, containerNumber: string) {
    // Cherche dans les pré-gates OPEN ou IN_PROGRESS un conteneur attendu
    const line = await this.prisma.preGateLine.findFirst({
      where: {
        containerNumber: containerNumber.toUpperCase(),
        status: 'EXPECTED',
        preGate: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      },
      include: {
        preGate: {
          select: {
            id: true,
            voyageCode: true,
            vesselName: true,
            transportMode: true,
            shippingLine: true,
            clientId: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    });
    return { found: !!line, line };
  }

  // Recherche partielle (préfixe, insensible à la casse) parmi les conteneurs
  // encore attendus — utilisée pour la liste consultable côté Gate-IN scan,
  // en complément du match exact de scanContainer.
  async searchExpectedContainers(tenantId: string, q: string) {
    const query = (q ?? '').trim().toUpperCase();
    if (query.length < 2) return [];

    const lines = await this.prisma.preGateLine.findMany({
      where: {
        containerNumber: { contains: query, mode: 'insensitive' },
        status: 'EXPECTED',
        preGate: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      },
      include: {
        preGate: {
          select: {
            id: true,
            voyageCode: true,
            vesselName: true,
            transportMode: true,
            shippingLine: true,
            clientId: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { containerNumber: 'asc' },
      take: 20,
    });

    return lines;
  }
}
