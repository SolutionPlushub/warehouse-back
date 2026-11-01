import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  // Liste les alertes du tenant courant — ouvert à tout rôle authentifié
  @Get()
  listAlerts(
    @Request() req: AuthRequest,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.alertsService.listAlerts(
      req.user.tenantId,
      unreadOnly === 'true',
    );
  }

  // Marque une alerte comme lue
  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.alertsService.markAlertRead(id, req.user.tenantId);
  }

  // Marque toutes les alertes du tenant comme lues
  @Patch('read-all')
  markAllRead(@Request() req: AuthRequest) {
    return this.alertsService.markAllAlertsRead(req.user.tenantId);
  }

  // Force un scan immédiat (admin uniquement, utile en dev/ops)
  @Post('scan-sommier')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  scanSommier(@Request() _req: AuthRequest) {
    return this.alertsService.scanAndScheduleAll();
  }

  // Force un scan immédiat des conteneurs en attente de positionnement
  @Post('scan-positioning')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  scanPositioning(@Request() _req: AuthRequest) {
    return this.alertsService.scanPositioningDelays();
  }

  @Post('scan-stay-franchise')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  scanStayFranchise(@Request() _req: AuthRequest) {
    return this.alertsService.scanStayFranchiseAlerts();
  }
}
