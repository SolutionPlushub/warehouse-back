import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlertLevel,
  AlertType,
  ShipmentFileStatus,
  YardContainerStatus,
} from '@prisma/client';
import {
  ALERTS_QUEUE,
  SommierAlertJob,
  PositioningAlertJob,
  StayFranchiseAlertJob,
} from './alerts.processor';

const SOMMIER_THRESHOLDS = [30, 7, 0]; // jours avant expiration
const POSITIONING_ALERT_HOURS = 24; // seuil avant alerte "en attente de positionnement"
const POSITIONING_SCAN_CRON = '0 * * * *'; // toutes les heures

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectQueue(ALERTS_QUEUE) private readonly alertsQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  // Enregistre le job récurrent de scan des conteneurs en attente de
  // positionnement — jobId fixe : idempotent si le module redémarre.
  // Ne doit jamais faire échouer le bootstrap de l'app si Redis est
  // indisponible/lent (queue lazyConnect) — on logue et on continue.
  onModuleInit() {
    this.alertsQueue
      .add(
        'positioning-scan',
        {},
        {
          jobId: 'positioning-scan-repeat',
          repeat: { cron: POSITIONING_SCAN_CRON },
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Impossible de planifier le scan positionnement récurrent (Redis indisponible ?) : ${message}`,
        );
      });
    this.alertsQueue
      .add(
        'stay-franchise-scan',
        {},
        {
          jobId: 'stay-franchise-scan-repeat',
          repeat: { cron: POSITIONING_SCAN_CRON },
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Impossible de planifier le scan franchise séjour (Redis indisponible ?) : ${message}`,
        );
      });
  }

  // ── Planifie les 3 jobs Bull pour un dossier ENTREPOT_FICTIF ─────────────

  async scheduleSommierAlerts(
    shipmentFileId: string,
    sommierExpiryDate: Date,
    tenantId: string,
    voyageCode: string,
    clientRef: string | null,
  ) {
    const adminUsers = await this.prisma.user.findMany({
      where: { tenantId, role: { in: ['ADMIN', 'CUSTOMS'] }, isActive: true },
      select: { email: true },
    });
    const adminEmails = adminUsers.map((u) => u.email);

    for (const days of SOMMIER_THRESHOLDS) {
      const triggerAt = new Date(sommierExpiryDate);
      triggerAt.setDate(triggerAt.getDate() - days);

      const delay = triggerAt.getTime() - Date.now();
      if (delay < 0) {
        // La date est déjà passée — on envoie l'alerte immédiatement
        this.logger.warn(
          `Sommier J-${days} déjà dépassé pour ${voyageCode}, envoi immédiat.`,
        );
      }

      const jobData: SommierAlertJob = {
        tenantId,
        shipmentFileId,
        voyageCode,
        clientRef,
        sommierExpiryDate: sommierExpiryDate.toISOString().slice(0, 10),
        daysRemaining: days,
        adminEmails,
      };

      await this.alertsQueue.add('sommier-alert', jobData, {
        delay: Math.max(0, delay),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId: `sommier-${shipmentFileId}-j${days}`,
        // jobId unique → pas de doublon si on réappelle scheduleSommierAlerts
        removeOnComplete: true,
        removeOnFail: false,
      });

      this.logger.log(
        `Job sommier-alert J-${days} planifié pour ${voyageCode} à ${triggerAt.toISOString()}`,
      );
    }
  }

  // ── Annule les jobs d'un dossier (ex : dossier soldé ou annulé) ──────────

  async cancelSommierAlerts(shipmentFileId: string) {
    for (const days of SOMMIER_THRESHOLDS) {
      const job = await this.alertsQueue.getJob(
        `sommier-${shipmentFileId}-j${days}`,
      );
      if (job) {
        await job.remove();
        this.logger.log(`Job sommier J-${days} annulé pour ${shipmentFileId}`);
      }
    }
  }

  // ── Scan périodique (cron) : replanifie les alertes manquantes ──────────
  // Appelé depuis AlertsModule via un @Cron si Bull n'a pas de jobs persistants

  async scanAndScheduleAll() {
    const files = await this.prisma.shipmentFile.findMany({
      where: {
        sommierExpiryDate: { not: null },
        status: {
          notIn: [ShipmentFileStatus.FULLY_OUT, ShipmentFileStatus.BLOCKED],
        },
      },
      select: {
        id: true,
        tenantId: true,
        voyageCode: true,
        clientRef: true,
        sommierExpiryDate: true,
      },
    });

    let scheduled = 0;
    for (const f of files) {
      if (!f.sommierExpiryDate) continue;

      // Ne replanifie que si aucun job n'existe déjà pour ce dossier
      const existingJob = await this.alertsQueue.getJob(`sommier-${f.id}-j30`);
      if (!existingJob) {
        await this.scheduleSommierAlerts(
          f.id,
          f.sommierExpiryDate,
          f.tenantId,
          f.voyageCode,
          f.clientRef,
        );
        scheduled++;
      }
    }

    this.logger.log(
      `Scan sommier : ${files.length} dossiers EF, ${scheduled} replanifiés.`,
    );
    return { scanned: files.length, scheduled };
  }

  // ── Scan périodique : conteneurs en attente de positionnement > seuil ────
  // Appelé par un job Bull `repeat` (voir AlertsModule) toutes les heures.
  // Une seule alerte par conteneur et par jour (jobId inclut la date) — évite
  // de spammer à chaque exécution du scan tant que le conteneur n'est pas
  // confirmé ou n'est plus en POSITIONING.

  async scanPositioningDelays() {
    const threshold = new Date(
      Date.now() - POSITIONING_ALERT_HOURS * 60 * 60 * 1000,
    );

    const containers = await this.prisma.yardContainer.findMany({
      where: {
        status: YardContainerStatus.POSITIONING,
        gateInDate: { lte: threshold },
      },
      select: {
        id: true,
        tenantId: true,
        containerNumber: true,
        gateInDate: true,
      },
    });

    let scheduled = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const c of containers) {
      if (!c.gateInDate) continue;

      const jobId = `positioning-${c.id}-${today}`;
      const existingJob = await this.alertsQueue.getJob(jobId);
      if (existingJob) continue;

      const adminUsers = await this.prisma.user.findMany({
        where: {
          tenantId: c.tenantId,
          role: { in: ['ADMIN', 'AGENT'] },
          isActive: true,
        },
        select: { email: true },
      });

      const hoursElapsed = Math.floor(
        (Date.now() - c.gateInDate.getTime()) / (60 * 60 * 1000),
      );

      const jobData: PositioningAlertJob = {
        tenantId: c.tenantId,
        yardContainerId: c.id,
        containerNumber: c.containerNumber,
        gateInDate: c.gateInDate.toISOString(),
        hoursElapsed,
        adminEmails: adminUsers.map((u) => u.email),
      };

      await this.alertsQueue.add('positioning-alert', jobData, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
      scheduled++;
    }

    this.logger.log(
      `Scan positionnement : ${containers.length} conteneur(s) en attente > ${POSITIONING_ALERT_HOURS}h, ${scheduled} alerte(s) planifiée(s).`,
    );
    return { scanned: containers.length, scheduled };
  }

  // ── Alerte fin de franchise séjour (J-N avant magasinage facturable) ─────

  async scheduleStayFranchiseAlert(params: {
    shipmentFileId: string;
    tenantId: string;
    voyageCode: string;
    clientRef: string | null;
    storageStartedAt: Date;
    freetimeDays: number;
  }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { stayAlertLeadDays: true },
    });
    const leadDays = tenant?.stayAlertLeadDays ?? 2;
    if (leadDays <= 0 || params.freetimeDays <= 0) {
      await this.cancelStayFranchiseAlert(params.shipmentFileId);
      return;
    }

    const franchiseEnd = new Date(params.storageStartedAt);
    franchiseEnd.setDate(franchiseEnd.getDate() + params.freetimeDays);
    const triggerAt = new Date(franchiseEnd);
    triggerAt.setDate(triggerAt.getDate() - leadDays);

    const adminUsers = await this.prisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        role: { in: ['ADMIN', 'AGENT', 'DEX'] },
        isActive: true,
      },
      select: { email: true },
    });

    const jobData: StayFranchiseAlertJob = {
      tenantId: params.tenantId,
      shipmentFileId: params.shipmentFileId,
      voyageCode: params.voyageCode,
      clientRef: params.clientRef,
      freetimeDays: params.freetimeDays,
      leadDays,
      franchiseEnd: franchiseEnd.toISOString().slice(0, 10),
      adminEmails: adminUsers.map((u) => u.email),
    };

    const jobId = `stay-franchise-${params.shipmentFileId}`;
    if (triggerAt.getTime() <= Date.now()) {
      await this.persistAlert({
        tenantId: params.tenantId,
        type: AlertType.STAY_FRANCHISE,
        level: AlertLevel.WARNING,
        message: `Dossier ${params.voyageCode}${params.clientRef ? ` (${params.clientRef})` : ''} — franchise séjour expire dans ${leadDays} jour(s) (${jobData.franchiseEnd})`,
        entityType: 'ShipmentFile',
        entityId: params.shipmentFileId,
        dedupeKey: jobId,
      });
    }

    try {
      const existing = await this.alertsQueue.getJob(jobId);
      if (existing) await existing.remove();
      await this.alertsQueue.add('stay-franchise-alert', jobData, {
        delay: Math.max(0, triggerAt.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(
        `Job stay-franchise-alert J-${leadDays} planifié pour ${params.voyageCode} à ${triggerAt.toISOString()}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `File d'alerte indisponible pour ${params.voyageCode} : ${message}`,
      );
    }
  }

  async cancelStayFranchiseAlert(shipmentFileId: string) {
    const job = await this.alertsQueue.getJob(
      `stay-franchise-${shipmentFileId}`,
    );
    if (job) {
      await job.remove();
      this.logger.log(`Job stay-franchise annulé pour ${shipmentFileId}`);
    }
  }

  async rescheduleStayFranchiseAlerts(tenantId: string) {
    const ops = await this.prisma.operation.findMany({
      where: {
        tenantId,
        storageBillingStartedAt: { not: null },
        storageBillingEndedAt: null,
        shipmentFile: {
          status: {
            notIn: [ShipmentFileStatus.FULLY_OUT, ShipmentFileStatus.BLOCKED],
          },
        },
      },
      select: {
        storageBillingStartedAt: true,
        storageFreetimeDays: true,
        shipmentFile: {
          select: { id: true, voyageCode: true, clientRef: true },
        },
      },
    });
    for (const op of ops) {
      if (!op.storageBillingStartedAt) continue;
      await this.scheduleStayFranchiseAlert({
        shipmentFileId: op.shipmentFile.id,
        tenantId,
        voyageCode: op.shipmentFile.voyageCode,
        clientRef: op.shipmentFile.clientRef,
        storageStartedAt: op.storageBillingStartedAt,
        freetimeDays: op.storageFreetimeDays ?? 0,
      });
    }
    return { rescheduled: ops.length };
  }

  async scanStayFranchiseAlerts() {
    const ops = await this.prisma.operation.findMany({
      where: {
        storageBillingStartedAt: { not: null },
        storageBillingEndedAt: null,
        shipmentFile: {
          status: {
            notIn: [ShipmentFileStatus.FULLY_OUT, ShipmentFileStatus.BLOCKED],
          },
        },
      },
      select: {
        tenantId: true,
        storageBillingStartedAt: true,
        storageFreetimeDays: true,
        shipmentFile: {
          select: { id: true, voyageCode: true, clientRef: true },
        },
      },
    });

    let scheduled = 0;
    for (const op of ops) {
      if (!op.storageBillingStartedAt) continue;
      const jobId = `stay-franchise-${op.shipmentFile.id}`;
      const existing = await this.alertsQueue.getJob(jobId);
      if (existing) continue;
      await this.scheduleStayFranchiseAlert({
        shipmentFileId: op.shipmentFile.id,
        tenantId: op.tenantId,
        voyageCode: op.shipmentFile.voyageCode,
        clientRef: op.shipmentFile.clientRef,
        storageStartedAt: op.storageBillingStartedAt,
        freetimeDays: op.storageFreetimeDays ?? 0,
      });
      scheduled++;
    }

    this.logger.log(
      `Scan franchise séjour : ${ops.length} séjour(s) en cours, ${scheduled} alerte(s) planifiée(s).`,
    );
    return { scanned: ops.length, scheduled };
  }

  // ── Événements gate (asynchrones) ────────────────────────────────────────

  async queueGateEvent(
    type: 'IN' | 'OUT',
    containerNumber: string,
    tenantId: string,
  ) {
    await this.alertsQueue.add(
      'gate-event',
      { type, containerNumber, tenantId },
      { attempts: 2, removeOnComplete: true },
    );
  }

  // ── Centre de notifications (consultable côté UI) ────────────────────────
  // Persiste une alerte en base — appelé par AlertsProcessor en plus du log
  // serveur. dedupeKey réutilise le jobId Bull déjà déterministe (idempotent :
  // un upsert sur un job déjà traité ne crée pas de doublon).

  async persistAlert(params: {
    tenantId: string;
    type: AlertType;
    level: AlertLevel;
    message: string;
    entityType?: string;
    entityId?: string;
    dedupeKey: string;
  }) {
    const { dedupeKey, ...data } = params;
    await this.prisma.alert.upsert({
      where: { dedupeKey },
      create: { ...data, dedupeKey },
      update: {}, // déjà persistée — ne pas écraser readAt si déjà lue
    });
  }

  async listAlerts(tenantId: string, unreadOnly = false) {
    return this.prisma.alert.findMany({
      where: { tenantId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAlertRead(id: string, tenantId: string) {
    const alert = await this.prisma.alert.findFirst({
      where: { id, tenantId },
    });
    if (!alert) return null;
    if (alert.readAt) return alert;
    return this.prisma.alert.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllAlertsRead(tenantId: string) {
    const { count } = await this.prisma.alert.updateMany({
      where: { tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }
}
