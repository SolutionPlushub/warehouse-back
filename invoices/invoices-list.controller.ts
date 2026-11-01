import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

// Vue Billing (liste globale, toutes clientèles) — distincte de
// InvoicesController qui reste scopé à wms/shipments/:fileId/invoice.
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('invoices')
export class InvoicesListController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.DEX,
    UserRole.CUSTOMS,
  )
  list(
    @Query('status') status: string | undefined,
    @Query('clientId') clientId: string | undefined,
    @Request() req: AuthRequest,
    @Query('includeDrafts') includeDrafts?: string,
  ) {
    return this.invoicesService.list(req.user.tenantId, {
      status,
      clientId,
      includeDrafts: includeDrafts === 'true',
    });
  }
}
