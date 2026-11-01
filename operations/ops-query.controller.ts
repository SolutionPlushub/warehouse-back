import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('ops')
export class OpsQueryController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get('dashboard')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.DEX,
  )
  getDashboard(@Request() req: AuthRequest) {
    return this.operationsService.getDashboard(req.user.tenantId);
  }

  @Get('execution-queue')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  getExecutionQueue(
    @Request() req: AuthRequest,
    @Query('direction') direction?: 'IN' | 'OUT',
  ) {
    return this.operationsService.getExecutionQueue(
      req.user.tenantId,
      direction === 'IN' || direction === 'OUT' ? direction : undefined,
    );
  }

  @Get('pickup-trucks')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.DEX,
  )
  listPickupWaiting(@Request() req: AuthRequest) {
    return this.operationsService.listPickupWaiting(req.user.tenantId);
  }
}
