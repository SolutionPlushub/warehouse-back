import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DosConfigService } from './dos-config.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UpsertDexProfileDto } from './dto/upsert-dex-profile.dto';
import { BlockClientDto } from './dto/block-client.dto';
import { UpsertStayEngineDto } from './dto/upsert-stay-engine.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('dos-config')
export class DosConfigController {
  constructor(private readonly svc: DosConfigService) {}

  // ── Profil DEX ────────────────────────────────────────────────────────────

  @Get('dex-profile')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  getDexProfile(@Request() req: AuthRequest) {
    return this.svc.getDexProfile(req.user.tenantId);
  }

  @Post('dex-profile')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  setDexProfile(@Request() req: AuthRequest, @Body() dto: UpsertDexProfileDto) {
    return this.svc.setDexProfile(req.user.tenantId, req.user.id, dto);
  }

  // ── Blocage comptable des clients — levée réservée DEX/ADMIN du tenant ──

  @Get('blocked-clients')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  listBlockedClients(@Request() req: AuthRequest) {
    return this.svc.listBlockedClients(req.user.tenantId);
  }

  @Get('blocked-clients/:clientId')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  isClientBlocked(
    @Request() req: AuthRequest,
    @Param('clientId') clientId: string,
  ) {
    return this.svc.isClientBlocked(req.user.tenantId, clientId);
  }

  @Post('blocked-clients/:clientId')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  blockClient(
    @Request() req: AuthRequest,
    @Param('clientId') clientId: string,
    @Body() dto: BlockClientDto,
  ) {
    return this.svc.blockClient(req.user.tenantId, clientId, req.user.id, dto);
  }

  @Delete('blocked-clients/:clientId')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  unblockClient(
    @Request() req: AuthRequest,
    @Param('clientId') clientId: string,
  ) {
    return this.svc.unblockClient(req.user.tenantId, clientId);
  }

  // ── Moteur de séjour (palier, week-ends, alerte J-N) ──────────────────────

  @Get('stay-engine')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  getStayEngine(@Request() req: AuthRequest) {
    return this.svc.getStayEngine(req.user.tenantId);
  }

  @Post('stay-engine')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  setStayEngine(@Request() req: AuthRequest, @Body() dto: UpsertStayEngineDto) {
    return this.svc.setStayEngine(req.user.tenantId, dto);
  }
}
