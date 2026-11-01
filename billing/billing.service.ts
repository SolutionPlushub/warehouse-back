import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { BILLING_QUEUE } from './billing.constants';

const TRIAL_SCAN_CRON = '0 * * * *'; // toutes les heures
const TRIAL_REMINDER_DAYS = [3, 1]; // relance email J-3 et J-1 avant fin d'essai

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectQueue(BILLING_QUEUE) private readonly billingQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.billingQueue
      .add(
        'trial-expiry-scan',
        {},
        {
          jobId: 'trial-expiry-scan-repeat',
          repeat: { cron: TRIAL_SCAN_CRON },
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Impossible de planifier le scan d'expiration d'essai (Redis indisponible ?) : ${message}`,
        );
      });
  }

  // Scanne les abonnements TRIALING : envoie une relance à J-3/J-1, et
  // fait passer en EXPIRED ceux dont trialEndsAt est dépassé.
  async expireOverdueTrials() {
    const now = new Date();

    const trialing = await this.prisma.subscription.findMany({
      where: { status: 'TRIALING', trialEndsAt: { not: null } },
      include: {
        tenant: {
          include: {
            users: {
              where: { role: 'ADMIN', isActive: true },
              select: { email: true, firstName: true },
            },
          },
        },
      },
    });

    for (const sub of trialing) {
      const trialEndsAt = sub.trialEndsAt as Date;
      const admin = sub.tenant.users[0];

      if (trialEndsAt.getTime() <= now.getTime()) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' },
        });
        await this.prisma.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            type: 'TRIAL_EXPIRED',
            payload: { trialEndsAt: trialEndsAt.toISOString() },
          },
        });
        this.logger.warn(
          `Essai expiré — tenant ${sub.tenant.name} (${sub.tenantId})`,
        );
        continue;
      }

      const daysRemaining = Math.ceil(
        (trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (admin && TRIAL_REMINDER_DAYS.includes(daysRemaining)) {
        const dedupeKey = `trial-reminder-${sub.id}-j${daysRemaining}`;
        const alreadySent = await this.prisma.subscriptionEvent.findFirst({
          where: { subscriptionId: sub.id, type: dedupeKey },
        });
        if (alreadySent) continue;

        await this.mail.sendTrialEndingSoon({
          to: admin.email,
          firstName: admin.firstName,
          daysRemaining,
          upgradeUrl: `${this.config.get('FRONTEND_URL')}/dashboard`,
        });
        await this.prisma.subscriptionEvent.create({
          data: { subscriptionId: sub.id, type: dedupeKey },
        });
      }
    }
  }
}
