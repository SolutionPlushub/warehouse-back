import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertDexProfileDto } from './dto/upsert-dex-profile.dto';
import { BlockClientDto } from './dto/block-client.dto';
import { UpsertStayEngineDto } from './dto/upsert-stay-engine.dto';
import { AlertsService } from '../alerts/alerts.service';
import { normalizeStayEngine } from '../stay-engine/stay-engine';

// Paramétrage DOS : profil DEX (signature/cachet) et blocage comptable des
// clients — miroir de dos-config-store.js (dex/blocked) côté frontend.
@Injectable()
export class DosConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alertsService?: AlertsService,
  ) {}

  async getStayEngine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        stayMonthlyThresholdDays: true,
        stayAlertLeadDays: true,
        stayWeekendsIncluded: true,
      },
    });
    return normalizeStayEngine({
      monthlyThresholdDays: tenant?.stayMonthlyThresholdDays,
      alertLeadDays: tenant?.stayAlertLeadDays,
      weekendsIncluded: tenant?.stayWeekendsIncluded,
    });
  }

  async setStayEngine(tenantId: string, dto: UpsertStayEngineDto) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.monthlyThresholdDays !== undefined && {
          stayMonthlyThresholdDays: dto.monthlyThresholdDays,
        }),
        ...(dto.alertLeadDays !== undefined && {
          stayAlertLeadDays: dto.alertLeadDays,
        }),
        ...(dto.weekendsIncluded !== undefined && {
          stayWeekendsIncluded: dto.weekendsIncluded,
        }),
      },
    });
    const engine = await this.getStayEngine(tenantId);
    void this.alertsService
      ?.rescheduleStayFranchiseAlerts(tenantId)
      .catch(() => undefined);
    return engine;
  }

  // ── Profil DEX ────────────────────────────────────────────────────────────

  async getDexProfile(tenantId: string) {
    const profile = await this.prisma.dexProfile.findUnique({
      where: { tenantId },
    });
    // Valeurs par défaut si aucun profil n'a encore été configuré — miroir
    // de la valeur initiale de `dex` côté frontend.
    return (
      profile ?? {
        tenantId,
        name: '',
        title: 'Directeur(trice) Exploitation',
        signatureUrl: null,
        stampUrl: null,
        mention: 'Bon pour sortie — Direction Exploitation',
        updatedAt: null,
        updatedById: null,
      }
    );
  }

  async setDexProfile(
    tenantId: string,
    userId: string,
    dto: UpsertDexProfileDto,
  ) {
    return this.prisma.dexProfile.upsert({
      where: { tenantId },
      create: {
        tenantId,
        name: dto.name ?? '',
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.signatureUrl !== undefined && {
          signatureUrl: dto.signatureUrl,
        }),
        ...(dto.stampUrl !== undefined && { stampUrl: dto.stampUrl }),
        ...(dto.mention !== undefined && { mention: dto.mention }),
        updatedById: userId,
      },
      update: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.signatureUrl !== undefined && {
          signatureUrl: dto.signatureUrl,
        }),
        ...(dto.stampUrl !== undefined && { stampUrl: dto.stampUrl }),
        ...(dto.mention !== undefined && { mention: dto.mention }),
        updatedById: userId,
      },
    });
  }

  // ── Blocage comptable des clients ────────────────────────────────────────

  async listBlockedClients(tenantId: string) {
    return this.prisma.clientAccountingBlock.findMany({
      where: { tenantId },
      include: { client: { select: { id: true, name: true, slug: true } } },
      orderBy: { blockedAt: 'desc' },
    });
  }

  async isClientBlocked(tenantId: string, clientId: string) {
    const block = await this.prisma.clientAccountingBlock.findUnique({
      where: { tenantId_clientId: { tenantId, clientId } },
    });
    return !!block;
  }

  async blockClient(
    tenantId: string,
    clientId: string,
    userId: string,
    dto: BlockClientDto,
  ) {
    const client = await this.prisma.tenant.findFirst({
      where: { id: clientId, type: 'CLIENT' },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client introuvable.');

    return this.prisma.clientAccountingBlock.upsert({
      where: { tenantId_clientId: { tenantId, clientId } },
      create: { tenantId, clientId, reason: dto.reason, blockedById: userId },
      update: {
        reason: dto.reason,
        blockedById: userId,
        blockedAt: new Date(),
      },
    });
  }

  async unblockClient(tenantId: string, clientId: string) {
    const deleted = await this.prisma.clientAccountingBlock.deleteMany({
      where: { tenantId, clientId },
    });
    if (deleted.count === 0)
      throw new BadRequestException("Ce client n'est pas bloqué.");
    return { ok: true };
  }
}
