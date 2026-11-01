import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { CargoService } from './cargo.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms/shipments/:fileId/cargo-units')
export class CargoController {
  constructor(private readonly cargoService: CargoService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.DEX,
  )
  listUnits(@Param('fileId') fileId: string, @Request() req: AuthRequest) {
    return this.cargoService.listUnits(fileId, req.user.tenantId);
  }
}
