import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { WmsAiController } from './wms-ai.controller';
import { WmsAiService } from './wms-ai.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PaymentsModule } from '../payments/payments.module';
import { OperationsModule } from '../operations/operations.module';
import { YmsModule } from '../yms/yms.module';
import { InducedServicesModule } from '../induced-services/induced-services.module';
import { AzureDocumentStorageService } from './azure-document-storage.service';

@Module({
  imports: [
    PrismaModule,
    AlertsModule,
    PaymentsModule,
    OperationsModule,
    YmsModule,
    InducedServicesModule,
    MulterModule.register({}),
  ],
  controllers: [WmsController, WmsAiController],
  providers: [WmsService, WmsAiService, AzureDocumentStorageService],
  exports: [WmsService],
})
export class WmsModule {}
