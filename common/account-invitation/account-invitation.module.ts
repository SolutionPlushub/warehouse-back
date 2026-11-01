import { Module } from '@nestjs/common';
import { AccountInvitationService } from './account-invitation.service';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [MailModule],
  providers: [AccountInvitationService],
  exports: [AccountInvitationService],
})
export class AccountInvitationModule {}
