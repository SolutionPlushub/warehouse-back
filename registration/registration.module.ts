import { Module } from '@nestjs/common';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { AccountInvitationModule } from '../common/account-invitation/account-invitation.module';

@Module({
  imports: [AccountInvitationModule],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class RegistrationModule {}
