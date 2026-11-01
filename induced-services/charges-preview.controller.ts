import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InducedServicesService } from './induced-services.service';
import { PreviewChargesDto } from './dto/preview-charges.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

// Aperçu des charges de la grille tarifaire pour un dossier en cours de
// création (wizard, étape Finance) — aucune écriture.
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('induced-services')
export class ChargesPreviewController {
  constructor(private readonly inducedServices: InducedServicesService) {}

  @Post('preview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  previewCharges(@Request() req: AuthRequest, @Body() dto: PreviewChargesDto) {
    return this.inducedServices.preview(req.user.tenantId, dto);
  }
}
