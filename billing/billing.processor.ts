import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { BillingService } from './billing.service';
import { BILLING_QUEUE } from './billing.constants';

@Processor(BILLING_QUEUE)
export class BillingProcessor {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(private readonly billingService: BillingService) {}

  @Process('trial-expiry-scan')
  async handleTrialExpiryScan(_job: Job) {
    await this.billingService.expireOverdueTrials();
  }
}
