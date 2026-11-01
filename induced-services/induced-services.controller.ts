import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InducedServicesService } from './induced-services.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ResolveInducedServicesDto } from './dto/resolve-induced-services.dto';
import {
  AddManualServiceLineDto,
  UpdateServiceLineDto,
} from './dto/manual-service-line.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms/shipments/:fileId/induced-services')
export class InducedServicesController {
  constructor(
    private readonly inducedServicesService: InducedServicesService,
  ) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  findByFile(@Param('fileId') fileId: string, @Request() req: AuthRequest) {
    return this.inducedServicesService.findByFile(fileId, req.user.tenantId);
  }

  // Résout automatiquement les prestations induites (obligatoires +
  // conditionnelles) rattachées aux opérations du dossier — voir Note
  // logique de service DMT Hub. Remplace les lignes précédemment générées
  // automatiquement, conserve les lignes manuelles.
  @Post('resolve')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  resolve(
    @Param('fileId') fileId: string,
    @Body() dto: ResolveInducedServicesDto,
    @Request() req: AuthRequest,
  ) {
    return this.inducedServicesService.resolve(fileId, req.user.tenantId, dto);
  }

  // ── Lignes manuelles (au-delà des prestations induites) ──────────────────

  @Post('lines')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  addManualLine(
    @Param('fileId') fileId: string,
    @Body() dto: AddManualServiceLineDto,
    @Request() req: AuthRequest,
  ) {
    return this.inducedServicesService.addManualLine(
      fileId,
      req.user.tenantId,
      dto,
    );
  }

  @Patch('lines/:lineId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  updateLine(
    @Param('fileId') fileId: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateServiceLineDto,
    @Request() req: AuthRequest,
  ) {
    return this.inducedServicesService.updateLine(
      fileId,
      req.user.tenantId,
      lineId,
      dto,
    );
  }

  @Delete('lines/:lineId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  removeLine(
    @Param('fileId') fileId: string,
    @Param('lineId') lineId: string,
    @Request() req: AuthRequest,
  ) {
    return this.inducedServicesService.removeLine(
      fileId,
      req.user.tenantId,
      lineId,
    );
  }
}
