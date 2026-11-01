import { Module } from '@nestjs/common';
import { DosConfigController } from './dos-config.controller';
import { DosConfigService } from './dos-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [PrismaModule, AlertsModule],
  controllers: [DosConfigController],
  providers: [DosConfigService],
  exports: [DosConfigService],
})
export class DosConfigModule {}
