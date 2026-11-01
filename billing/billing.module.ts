import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PlanLimitsService } from './plan-limits.service';
import { BillingService } from './billing.service';
import { BillingProcessor } from './billing.processor';
import { BILLING_QUEUE } from './billing.constants';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule, BullModule.registerQueue({ name: BILLING_QUEUE })],
  providers: [PlanLimitsService, BillingService, BillingProcessor],
  exports: [PlanLimitsService],
})
export class BillingModule {}
