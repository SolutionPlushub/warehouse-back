import { Module } from '@nestjs/common';
import { InducedServicesController } from './induced-services.controller';
import { InducedServicesService } from './induced-services.service';
import { ChargesPreviewController } from './charges-preview.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InducedServicesController, ChargesPreviewController],
  providers: [InducedServicesService],
  exports: [InducedServicesService],
})
export class InducedServicesModule {}
