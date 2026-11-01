import { Module } from '@nestjs/common';
import { ReferentielsController } from './referentiels.controller';
import { ReferentielsService } from './referentiels.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReferentielsController],
  providers: [ReferentielsService],
  exports: [ReferentielsService],
})
export class ReferentielsModule {}
