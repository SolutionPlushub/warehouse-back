import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpsertStorageRegimeDto,
  UpsertShipmentTypeDto,
  UpsertPackageTypeDto,
  UpsertStorageZoneDto,
  UpsertCarrierDto,
  UpsertEquipmentDto,
  CreateTariffDto,
  UpdateTariffDto,
} from './dto/upsert-ref.dto';
import { UpsertYardDto } from './dto/upsert-yard.dto';

const PLACE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

export function normalizePlaceCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!PLACE_CODE.test(code)) {
    throw new BadRequestException(
      'Code invalide. Utilisez des lettres et des chiffres, par exemple ML002.',
    );
  }
  return code;
}

function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

@Injectable()
export class ReferentielsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lecture groupée (un seul appel frontend) ─────────────────────────────

  async getAll(tenantId: string) {
    const [storageRegimes, shipmentTypes, packageTypes, storageZones, yards] =
      await Promise.all([
        this.prisma.storageRegimeRef.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        }),
        this.prisma.shipmentTypeRef.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        }),
        this.prisma.packageTypeRef.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        }),
        this.prisma.storageZone.findMany({
          where: { tenantId },
          include: { yard: { select: { id: true, code: true, name: true } } },
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        }),
        this.prisma.yard.findMany({
          where: { tenantId },
          include: {
            _count: { select: { storageZones: true, yardPositions: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);
    return { storageRegimes, shipmentTypes, packageTypes, storageZones, yards };
  }

  // ── Yards ────────────────────────────────────────────────────────────────

  async listYards(tenantId: string) {
    return this.prisma.yard.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            storageZones: true,
            yardPositions: true,
            yardContainers: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async upsertYard(tenantId: string, dto: UpsertYardDto) {
    const previous = dto.previousCode?.trim();
    const typed = dto.code?.trim();
    const code =
      previous && typed === previous
        ? previous
        : normalizePlaceCode(typed || slugify(dto.name));
    const shared = {
      name: dto.name,
      type: dto.type,
      ...(dto.surfaceM2 !== undefined && { surfaceM2: dto.surfaceM2 }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.perimeter !== undefined && {
        perimeter: dto.perimeter as unknown as Prisma.InputJsonValue,
      }),
    };
    if (previous) {
      const existing = await this.prisma.yard.findUnique({
        where: { tenantId_code: { tenantId, code: previous } },
      });
      if (!existing) throw new NotFoundException('Dépôt introuvable.');
      if (code !== previous) {
        const clash = await this.prisma.yard.findUnique({
          where: { tenantId_code: { tenantId, code } },
        });
        if (clash)
          throw new ConflictException(
            `Le code ${code} est déjà utilisé par un autre dépôt.`,
          );
      }
      return this.prisma.yard.update({
        where: { id: existing.id },
        data: { ...shared, code },
      });
    }
    return this.prisma.yard.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, ...shared },
      update: shared,
    });
  }

  async patchYardStackingRules(
    tenantId: string,
    code: string,
    stackingRules: Record<string, unknown>,
  ) {
    const yard = await this.prisma.yard.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!yard) throw new NotFoundException('Yard introuvable.');
    return this.prisma.yard.update({
      where: { tenantId_code: { tenantId, code } },
      data: { stackingRules: stackingRules as Prisma.InputJsonValue },
    });
  }

  async deleteYard(tenantId: string, code: string) {
    const yard = await this.prisma.yard.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: {
        id: true,
        _count: {
          select: {
            storageZones: true,
            yardContainers: true,
            defaultShipmentFiles: true,
          },
        },
      },
    });
    if (!yard) throw new NotFoundException('Yard introuvable.');
    return this.prisma.yard.delete({
      where: { tenantId_code: { tenantId, code } },
    });
  }

  // ── Storage Regimes ──────────────────────────────────────────────────────

  async listStorageRegimes(tenantId: string) {
    return this.prisma.storageRegimeRef.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async upsertStorageRegime(tenantId: string, dto: UpsertStorageRegimeDto) {
    const code = dto.code?.trim() || slugify(dto.label);
    const labelShort = dto.labelShort?.trim() || code.slice(0, 6);
    const shared = {
      label: dto.label,
      labelShort,
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.bg !== undefined && { bg: dto.bg }),
      ...(dto.sommierDays !== undefined && { sommierDays: dto.sommierDays }),
      ...(dto.sommierExtensionDays !== undefined && {
        sommierExtensionDays: dto.sommierExtensionDays,
      }),
      ...(dto.sommierMaxExtensions !== undefined && {
        sommierMaxExtensions: dto.sommierMaxExtensions,
      }),
      ...(dto.alertThresholds !== undefined && {
        alertThresholds:
          dto.alertThresholds as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.entryFieldConfig !== undefined && {
        entryFieldConfig:
          dto.entryFieldConfig as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.exitFieldConfig !== undefined && {
        exitFieldConfig:
          dto.exitFieldConfig as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.documentConfig !== undefined && {
        documentConfig: dto.documentConfig as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    };
    return this.prisma.storageRegimeRef.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, ...shared },
      update: shared,
    });
  }

  async deleteStorageRegime(tenantId: string, code: string) {
    return this.prisma.storageRegimeRef.deleteMany({
      where: { tenantId, code },
    });
  }

  // ── Shipment Types ───────────────────────────────────────────────────────

  async listShipmentTypes(tenantId: string) {
    return this.prisma.shipmentTypeRef.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async upsertShipmentType(tenantId: string, dto: UpsertShipmentTypeDto) {
    const code = dto.code?.trim() || slugify(dto.label);
    return this.prisma.shipmentTypeRef.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, ...dto, code },
      update: {
        label: dto.label,
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteShipmentType(tenantId: string, code: string) {
    return this.prisma.shipmentTypeRef.deleteMany({
      where: { tenantId, code },
    });
  }

  // ── Package Types ────────────────────────────────────────────────────────

  async listPackageTypes(tenantId: string) {
    return this.prisma.packageTypeRef.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async upsertPackageType(tenantId: string, dto: UpsertPackageTypeDto) {
    const code = dto.code?.trim() || slugify(dto.label);
    return this.prisma.packageTypeRef.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, ...dto, code },
      update: {
        label: dto.label,
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deletePackageType(tenantId: string, code: string) {
    return this.prisma.packageTypeRef.deleteMany({
      where: { tenantId, code },
    });
  }

  // ── Storage Zones ────────────────────────────────────────────────────────

  // Occupation réelle (m²) : même agrégat que OperationsService.reserveCapacity()
  // (mode=warehouse) — ShipmentLine.surfaceM2 des lignes encore IN_STOCK/RESERVED
  // dans la zone. Exposé ici pour que l'UI de réservation (CapacityProcedure)
  // affiche la même disponibilité que celle qui sera réellement vérifiée.
  async listStorageZones(tenantId: string) {
    const zones = await this.prisma.storageZone.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    if (!zones.length) return zones;
    const usage = await this.prisma.shipmentLine.groupBy({
      by: ['zoneId'],
      where: {
        zoneId: { in: zones.map((z) => z.id) },
        status: { in: ['IN_STOCK', 'RESERVED'] },
      },
      _sum: { surfaceM2: true },
    });
    const usedByZone = new Map(
      usage.map((u) => [u.zoneId, u._sum.surfaceM2 ?? 0]),
    );
    // Réservation entrepôt posée sur un conteneur seul (pas de colis) :
    // la surface vit dans OperationLine.slot, une fois par opération.
    const slotLines = await this.prisma.operationLine.findMany({
      where: { operation: { tenantId } },
      select: { operationId: true, shipmentLineId: true, slot: true },
    });
    const opsWithPackages = new Set(
      slotLines.filter((l) => l.shipmentLineId).map((l) => l.operationId),
    );
    const seenOp = new Set<string>();
    for (const line of slotLines) {
      if (line.shipmentLineId || opsWithPackages.has(line.operationId)) continue;
      if (seenOp.has(line.operationId)) continue;
      const slot = line.slot as { zoneId?: string; surfaceM2?: number } | null;
      if (!slot?.zoneId || !(slot.surfaceM2 && slot.surfaceM2 > 0)) continue;
      seenOp.add(line.operationId);
      usedByZone.set(
        slot.zoneId,
        (usedByZone.get(slot.zoneId) ?? 0) + slot.surfaceM2,
      );
    }
    return zones.map((z) => {
      const usedM2 = usedByZone.get(z.id) ?? 0;
      return {
        ...z,
        usedM2,
        remainingM2: z.surfaceM2 != null ? z.surfaceM2 - usedM2 : null,
      };
    });
  }

  async upsertStorageZone(tenantId: string, dto: UpsertStorageZoneDto) {
    const previous = dto.previousCode?.trim();
    const typed = dto.code?.trim();
    const code =
      previous && typed === previous
        ? previous
        : normalizePlaceCode(typed || slugify(dto.label));
    if (!dto.yardId) throw new Error('yardId est requis pour créer une zone.');
    const update = {
      label: dto.label,
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.surfaceM2 !== undefined && { surfaceM2: dto.surfaceM2 }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.polygon !== undefined && {
        polygon: dto.polygon as unknown as Prisma.InputJsonValue,
      }),
    };
    if (previous) {
      const existing = await this.prisma.storageZone.findUnique({
        where: { yardId_code: { yardId: dto.yardId, code: previous } },
      });
      if (!existing || existing.tenantId !== tenantId)
        throw new NotFoundException('Zone introuvable.');
      return this.prisma.$transaction(async (tx) => {
        if (code !== previous) {
          const clash = await tx.storageZone.findUnique({
            where: { yardId_code: { yardId: dto.yardId, code } },
          });
          if (clash)
            throw new ConflictException(
              `Le code ${code} est déjà utilisé par une autre zone de ce dépôt.`,
            );
          const lines = await tx.operationLine.findMany({
            where: {
              slot: { not: Prisma.DbNull },
              operation: { tenantId },
            },
            select: { id: true, slot: true },
          });
          for (const line of lines) {
            const slot = line.slot as { zoneId?: string } | null;
            if (!slot || slot.zoneId !== existing.id) continue;
            if (
              !line.slot ||
              typeof line.slot !== 'object' ||
              Array.isArray(line.slot)
            )
              continue;
            await tx.operationLine.update({
              where: { id: line.id },
              data: {
                slot: { ...(line.slot as Prisma.JsonObject), zoneCode: code },
              },
            });
          }
        }
        return tx.storageZone.update({
          where: { id: existing.id },
          data: { ...update, code },
        });
      });
    }
    return this.prisma.storageZone.upsert({
      where: { yardId_code: { yardId: dto.yardId, code } },
      create: { tenantId, yardId: dto.yardId, code, ...update },
      update,
    });
  }

  async deleteStorageZone(tenantId: string, code: string, yardId: string) {
    return this.prisma.storageZone.deleteMany({
      where: { tenantId, yardId, code },
    });
  }

  // ── Seed des données par défaut pour un nouveau tenant ──────────────────

  async seedDefaults(tenantId: string, yardId?: string) {
    const regimes: UpsertStorageRegimeDto[] = [
      {
        code: 'ENTREPOT_FICTIF',
        label: 'Entrepôt Fictif',
        labelShort: 'EF',
        color: '#7C5BC7',
        bg: '#F5F0FE',
        sommierDays: 365,
        sommierExtensionDays: 180,
        sommierMaxExtensions: 1,
        sortOrder: 0,
      },
      {
        code: 'MAD',
        label: 'MAD',
        labelShort: 'MAD',
        color: '#C29D3D',
        bg: '#FDF8EE',
        sortOrder: 1,
      },
      {
        code: 'WAREHOUSE_LIBRE',
        label: 'Entreposage libre',
        labelShort: 'LIBRE',
        color: '#15803D',
        bg: '#F0FDF4',
        sortOrder: 2,
      },
      {
        code: 'TRANSIT',
        label: 'Transit hinterland',
        labelShort: 'TRANSIT',
        color: '#0E7C5A',
        bg: '#ECFDF5',
        sortOrder: 3,
      },
    ];
    const shipTypes: UpsertShipmentTypeDto[] = [
      { code: 'SEA', label: 'Maritime', icon: 'ship', sortOrder: 0 },
      { code: 'AIR', label: 'Aérien', icon: 'plane', sortOrder: 1 },
      { code: 'ROAD', label: 'Routier', icon: 'truck', sortOrder: 2 },
    ];
    const pkgTypes: UpsertPackageTypeDto[] = [
      { code: 'PALLET', label: 'Palette', sortOrder: 0 },
      { code: 'BOX', label: 'Carton', sortOrder: 1 },
      { code: 'WOODEN_BOX', label: 'Caisse en bois', sortOrder: 2 },
      { code: 'VEHICLE', label: 'Véhicule', sortOrder: 3 },
      { code: 'CONTAINER', label: 'Conteneur', sortOrder: 4 },
      { code: 'OTHER', label: 'Autre', sortOrder: 5 },
    ];

    const ops: Promise<unknown>[] = [
      ...regimes.map((d) => this.upsertStorageRegime(tenantId, d)),
      ...shipTypes.map((d) => this.upsertShipmentType(tenantId, d)),
      ...pkgTypes.map((d) => this.upsertPackageType(tenantId, d)),
    ];

    if (yardId) {
      const zones: UpsertStorageZoneDto[] = [
        { code: 'ZONE-A', label: 'Zone A', yardId, sortOrder: 0 },
        { code: 'ZONE-B', label: 'Zone B', yardId, sortOrder: 1 },
        { code: 'ZONE-C', label: 'Zone C', yardId, sortOrder: 2 },
        { code: 'ZONE-D', label: 'Zone D', yardId, sortOrder: 3 },
        {
          code: 'ZONE-DGS',
          label: 'Zone DGS (Marchandises dangereuses)',
          yardId,
          sortOrder: 4,
        },
        {
          code: 'ZONE-FRIGO',
          label: 'Zone Frigorifique',
          yardId,
          sortOrder: 5,
        },
      ];
      ops.push(...zones.map((d) => this.upsertStorageZone(tenantId, d)));
    }

    await Promise.all(ops);
  }

  // ── Transporteurs ────────────────────────────────────────────────────────
  // Référentiel créable à la volée depuis le Gate — pas de code, juste un
  // nom unique par tenant. Miroir de DosConfig.carriers()/addCarrier().

  async listCarriers(tenantId: string) {
    return this.prisma.carrierRef.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async addCarrier(tenantId: string, dto: UpsertCarrierDto) {
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException('Le nom du transporteur est requis.');
    return this.prisma.carrierRef.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name },
      update: { isActive: true },
    });
  }

  async updateCarrier(tenantId: string, id: string, dto: UpsertCarrierDto) {
    const existing = await this.prisma.carrierRef.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Transporteur introuvable.');
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException('Le nom du transporteur est requis.');
    const conflict = await this.prisma.carrierRef.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (conflict && conflict.id !== id)
      throw new BadRequestException(
        `Un transporteur nommé « ${name} » existe déjà.`,
      );
    return this.prisma.carrierRef.update({ where: { id }, data: { name } });
  }

  async removeCarrier(tenantId: string, id: string) {
    return this.prisma.carrierRef.updateMany({
      where: { tenantId, id },
      data: { isActive: false },
    });
  }

  // ── Engins de manutention ────────────────────────────────────────────────
  // Référentiel CRUD (Paramétrage DOS) — même forme que Transporteurs.
  // Miroir de DosConfig.equipment()/addEquipment() côté frontend.

  async listEquipment(tenantId: string) {
    return this.prisma.handlingEquipmentRef.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async addEquipment(tenantId: string, dto: UpsertEquipmentDto) {
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException("Le nom de l'engin est requis.");
    return this.prisma.handlingEquipmentRef.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name },
      update: { isActive: true },
    });
  }

  async updateEquipment(tenantId: string, id: string, dto: UpsertEquipmentDto) {
    const existing = await this.prisma.handlingEquipmentRef.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Engin introuvable.');
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException("Le nom de l'engin est requis.");
    const conflict = await this.prisma.handlingEquipmentRef.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (conflict && conflict.id !== id)
      throw new BadRequestException(
        `Un engin nommé « ${name} » existe déjà.`,
      );
    return this.prisma.handlingEquipmentRef.update({
      where: { id },
      data: { name },
    });
  }

  async removeEquipment(tenantId: string, id: string) {
    return this.prisma.handlingEquipmentRef.updateMany({
      where: { tenantId, id },
      data: { isActive: false },
    });
  }

  // ── Grille tarifaire ─────────────────────────────────────────────────────
  // CRUD référentiel pour TariffRef — jusqu'ici consommé uniquement en
  // lecture interne par InducedServicesService. Miroir de DosConfig.tariffs()/
  // addTariff()/updateTariff()/toggleTariffOp()/removeTariff() côté frontend.

  async listTariffs(tenantId: string, includeInactive = false) {
    return this.prisma.tariffRef.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async createTariff(tenantId: string, dto: CreateTariffDto) {
    const code = dto.code?.trim() || slugify(dto.label);
    return this.prisma.tariffRef.create({
      data: {
        tenantId,
        code,
        domain: dto.domain,
        label: dto.label,
        unit: dto.unit,
        rate: dto.rate,
        applicableOps: dto.applicableOps ?? [],
        mandatory: dto.mandatory ?? false,
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async updateTariff(tenantId: string, id: string, dto: UpdateTariffDto) {
    const existing = await this.prisma.tariffRef.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Tarif introuvable.');

    return this.prisma.tariffRef.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code.trim() }),
        ...(dto.domain !== undefined && { domain: dto.domain }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.applicableOps !== undefined && {
          applicableOps: dto.applicableOps,
        }),
        ...(dto.mandatory !== undefined && { mandatory: dto.mandatory }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async removeTariff(tenantId: string, id: string) {
    return this.prisma.tariffRef.updateMany({
      where: { tenantId, id },
      data: { isActive: false },
    });
  }
}
