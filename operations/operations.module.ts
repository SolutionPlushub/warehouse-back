import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OpsQueryController } from './ops-query.controller';
import { OperationsService } from './operations.service';
import { TruckLoadsService } from './truck-loads.service';
import { TruckLoadsController } from './truck-loads.controller';
import { TransshipmentService } from './transshipment.service';
import { TransshipmentController } from './transshipment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { InducedServicesModule } from '../induced-services/induced-services.module';
import { YardMapModule } from '../yard-map/yard-map.module';
import { MailModule } from '../mail/mail.module';
import { TmsModule } from '../tms/tms.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    InducedServicesModule,
    YardMapModule,
    MailModule,
    TmsModule,
    AlertsModule,
  ],
  controllers: [
    OperationsController,
    OpsQueryController,
    TruckLoadsController,
    TransshipmentController,
  ],
  providers: [OperationsService, TruckLoadsService, TransshipmentService],
  exports: [OperationsService],
})
export class OperationsModule {}
