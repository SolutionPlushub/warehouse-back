import { Process, Processor } from '@nestjs/bull';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { AlertLevel, AlertType } from '@prisma/client';
import { AlertsService } from './alerts.service';

export const ALERTS_QUEUE = 'alerts';

export interface SommierAlertJob {
  tenantId: string;
  shipmentFileId: string;
  voyageCode: string;
  clientRef: string | null;
  sommierExpiryDate: string;
  daysRemaining: number;   // 30, 7 ou 0
  adminEmails: string[];
}

export interface PositioningAlertJob {
  tenantId: string;
  yardContainerId: string;
  containerNumber: string;
  gateInDate: string;
  hoursElapsed: number;
  adminEmails: string[];
}

export interface StayFranchiseAlertJob {
  tenantId: string;
  shipmentFileId: string;
  voyageCode: string;
  clientRef: string | null;
  freetimeDays: number;
  leadDays: number;
  franchiseEnd: string;
  adminEmails: string[];
}

@Processor(ALERTS_QUEUE)
export class AlertsProcessor {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(
    @Inject(forwardRef(() => AlertsService))
    private readonly alertsService: AlertsService,
  ) {}

  @Process('sommier-alert')
  async handleSommierAlert(job: Job<SommierAlertJob>) {
    const { tenantId, shipmentFileId, voyageCode, clientRef, sommierExpiryDate, daysRemaining, adminEmails } = job.data;

    const label =
      daysRemaining === 0
        ? '⚠️ EXPIRÉ AUJOURD\'HUI'
        : `⚠️ Expire dans ${daysRemaining} jour(s)`;

    this.logger.warn(
      `[Sommier] ${label} — Dossier ${voyageCode}${clientRef ? ` (${clientRef})` : ''} · Expiry: ${sommierExpiryDate}`,
    );
    this.logger.log(`  Destinataires : ${adminEmails.join(', ')}`);

    await this.alertsService.persistAlert({
      tenantId,
      type: AlertType.SOMMIER_EXPIRY,
      level: daysRemaining === 0 ? AlertLevel.DANGER : AlertLevel.WARNING,
      message: `Dossier ${voyageCode}${clientRef ? ` (${clientRef})` : ''} — ${label.replace('⚠️ ', '')}`,
      entityType: 'ShipmentFile',
      entityId: shipmentFileId,
      dedupeKey: `sommier-${shipmentFileId}-j${daysRemaining}`,
    });

    // TODO: intégrer SendGrid / Twilio ici
    // await this.mailService.sendSommierAlert(job.data);
    // await this.smsService.sendSommierAlert(job.data);
  }

  @Process('gate-event')
  handleGateEvent(job: Job<{ type: 'IN' | 'OUT'; containerNumber: string; tenantId: string }>) {
    const { type, containerNumber } = job.data;
    this.logger.log(`[Gate] ${type} — conteneur ${containerNumber}`);
  }

  @Process('positioning-alert')
  async handlePositioningAlert(job: Job<PositioningAlertJob>) {
    const { tenantId, yardContainerId, containerNumber, hoursElapsed, adminEmails } = job.data;

    this.logger.warn(
      `[Positionnement] ⚠️ Conteneur ${containerNumber} en attente de positionnement depuis ${hoursElapsed}h — emplacement non confirmé.`,
    );
    this.logger.log(`  Destinataires : ${adminEmails.join(', ')}`);

    await this.alertsService.persistAlert({
      tenantId,
      type: AlertType.POSITIONING_DELAY,
      level: AlertLevel.WARNING,
      message: `Conteneur ${containerNumber} en attente de positionnement depuis ${hoursElapsed}h`,
      entityType: 'YardContainer',
      entityId: yardContainerId,
      dedupeKey: job.opts.jobId?.toString() ?? `positioning-${yardContainerId}-${Date.now()}`,
    });

    // TODO: intégrer SendGrid / Twilio ici
    // await this.mailService.sendPositioningAlert(job.data);
  }

  // Job récurrent (repeat cron, voir AlertsService.onModuleInit) : scanne les
  // conteneurs en POSITIONING depuis trop longtemps et planifie une alerte
  // par conteneur détecté.
  @Process('positioning-scan')
  async handlePositioningScan() {
    await this.alertsService.scanPositioningDelays();
  }

  @Process('stay-franchise-alert')
  async handleStayFranchiseAlert(job: Job<StayFranchiseAlertJob>) {
    const {
      tenantId,
      shipmentFileId,
      voyageCode,
      clientRef,
      freetimeDays,
      leadDays,
      franchiseEnd,
      adminEmails,
    } = job.data;

    this.logger.warn(
      `[Séjour] Franchise J-${leadDays} — Dossier ${voyageCode}${clientRef ? ` (${clientRef})` : ''} · fin franchise ${franchiseEnd} (${freetimeDays} j)`,
    );
    this.logger.log(`  Destinataires : ${adminEmails.join(', ')}`);

    await this.alertsService.persistAlert({
      tenantId,
      type: AlertType.STAY_FRANCHISE,
      level: AlertLevel.WARNING,
      message: `Dossier ${voyageCode}${clientRef ? ` (${clientRef})` : ''} — franchise séjour expire dans ${leadDays} jour(s) (${franchiseEnd})`,
      entityType: 'ShipmentFile',
      entityId: shipmentFileId,
      dedupeKey: `stay-franchise-${shipmentFileId}`,
    });
  }

  @Process('stay-franchise-scan')
  async handleStayFranchiseScan() {
    await this.alertsService.scanStayFranchiseAlerts();
  }
}
