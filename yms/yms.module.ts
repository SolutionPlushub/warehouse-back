import { Module } from '@nestjs/common';
import { YmsController } from './yms.controller';
import { YmsService } from './yms.service';
import { ParkService } from './park.service';
import { YmsReferentielsController } from './yms-referentiels.controller';
import { YmsReferentielsService } from './yms-referentiels.service';
import { PrismaModule } from '../prisma/prisma.module';
import { YardMapModule } from '../yard-map/yard-map.module';
import { PaymentsModule } from '../payments/payments.module';
import { TmsModule } from '../tms/tms.module';

@Module({
  imports: [PrismaModule, YardMapModule, PaymentsModule, TmsModule],
  controllers: [YmsController, YmsReferentielsController],
  providers: [YmsService, YmsReferentielsService, ParkService],
  exports: [YmsService, YmsReferentielsService, ParkService],
})
export class YmsModule {}
