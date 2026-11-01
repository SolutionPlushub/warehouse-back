import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MailModule } from '../mail/mail.module';
import { AccountInvitationModule } from '../common/account-invitation/account-invitation.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [MailModule, AccountInvitationModule, BillingModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
