import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesListController } from './invoices-list.controller';
import { InvoicesService } from './invoices.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController, InvoicesListController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
