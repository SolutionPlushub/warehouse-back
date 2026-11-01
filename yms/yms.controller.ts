import {
  ForbiddenException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { YmsService } from './yms.service';
import { ParkService } from './park.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, YardContainerStatus, YardMovementType } from '@prisma/client';
import { GateInDto } from './dto/gate-in.dto';
import { GateOutDto } from './dto/gate-out.dto';
import { RepositionDto } from './dto/reposition.dto';
import { GateInFromPreGateDto } from './dto/gate-in-from-pregate.dto';
import { GateInBulkFromPreGateDto } from './dto/gate-in-bulk-from-pregate.dto';
import { ConfirmPositionDto } from './dto/confirm-position.dto';
import { UpdateGateInDateDto, UpdateGateOutDateDto } from './dto/update-gate-in-date.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('yms')
export class YmsController {
  constructor(
    private readonly ymsService: YmsService,
    private readonly park: ParkService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────────────────────

  @Get('dashboard')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  getDashboard(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.ymsService.getDashboard(req.user.tenantId, yardId);
  }

  // Indicateurs du Parc conteneurs (franchise, aujourd'hui, EVP par client).
  @Get('park-stats')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS, UserRole.DEX)
  getParkStats(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.park.parkStats(req.user.tenantId, yardId);
  }

  // Fiche client : conteneurs en yard, franchise, facturation, activité.
  @Get('clients/:clientId/overview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS, UserRole.DEX)
  getClientOverview(@Request() req: AuthRequest, @Param('clientId') clientId: string) {
    return this.park.clientOverview(req.user.tenantId, clientId);
  }

  // ── Conteneurs ────────────────────────────────────────────────────────────

  @Get('containers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listContainers(
    @Request() req: AuthRequest,
    @Query('status') status?: YardContainerStatus,
    @Query('search') search?: string,
    @Query('isBeingDevanned') isBeingDevanned?: string,
    @Query('yardId') yardId?: string,
    @Query('clientId') clientId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.ymsService.listContainers(req.user.tenantId, {
      status,
      search,
      isBeingDevanned:
        isBeingDevanned != null ? isBeingDevanned === 'true' : undefined,
      yardId,
      clientId,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('containers/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  getContainer(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ymsService.getContainer(id, req.user.tenantId);
  }

  // Correction de la date/heure de Gate In d'un conteneur autonome (pas de
  // dossier WMS/GatePass associé — voir UpdateGatePassDto côté WMS pour le
  // cas contraire). Réservée aux mêmes rôles que la correction WMS
  // équivalente (pas AGENT, pour garder les corrections d'audit tracées).
  // Correction de la date/heure réelle de sortie (Gate OUT déjà enregistré).
  @Patch('containers/:id/gate-out-date')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  updateGateOutDate(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateGateOutDateDto,
  ) {
    return this.ymsService.updateGateOutDate(id, req.user.tenantId, dto.gateOutAt);
  }

  @Patch('containers/:id/gate-in-date')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  updateGateInDate(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateGateInDateDto,
  ) {
    return this.ymsService.updateGateInDate(id, req.user.tenantId, dto);
  }

  // ── Gate-In ───────────────────────────────────────────────────────────────

  @Post('gate-in')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateIn(@Request() req: AuthRequest, @Body() dto: GateInDto) {
    return this.ymsService.gateIn(req.user.tenantId, req.user.id, dto);
  }

  @Post('gate-in/from-pregate')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateInFromPreGate(@Request() req: AuthRequest, @Body() dto: GateInFromPreGateDto) {
    return this.ymsService.gateInFromPreGate(req.user.tenantId, req.user.id, dto);
  }

  @Post('gate-in/from-pregate/bulk')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateInBulkFromPreGate(@Request() req: AuthRequest, @Body() dto: GateInBulkFromPreGateDto) {
    return this.ymsService.gateInBulkFromPreGate(req.user.tenantId, req.user.id, dto);
  }

  @Patch('containers/:id/confirm-position')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  confirmPosition(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: ConfirmPositionDto,
  ) {
    return this.ymsService.confirmPosition(id, req.user.tenantId, req.user.id, dto);
  }

  // ── Gate-Out ──────────────────────────────────────────────────────────────

  @Patch('containers/:id/gate-out')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateOut(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: GateOutDto,
  ) {
    // Régularisation (sortie passée sans camion connu) : correction de
    // données réservée aux profils ADMIN / DEX.
    if (
      dto.regularization &&
      !([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX] as UserRole[]).includes(
        req.user.role,
      )
    )
      throw new ForbiddenException(
        'La régularisation d’une sortie est réservée aux profils ADMIN / DEX.',
      );
    return this.ymsService.gateOut(id, req.user.tenantId, req.user.id, dto);
  }

  // ── Dépotage ──────────────────────────────────────────────────────────────

  @Patch('containers/:id/end-devanning')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  endDevanning(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ymsService.endDevanning(id, req.user.tenantId);
  }

  // ── Repositionnement ──────────────────────────────────────────────────────

  @Patch('containers/:id/reposition')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  reposition(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: RepositionDto,
  ) {
    return this.ymsService.reposition(id, req.user.tenantId, req.user.id, dto);
  }

  // ── Yard Map ──────────────────────────────────────────────────────────────

  @Get('map')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  getYardMap(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.ymsService.getYardMap(req.user.tenantId, yardId);
  }

  @Get('positions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  getPositions(
    @Request() req: AuthRequest,
    @Query('block') block?: string,
    @Query('yardId') yardId?: string,
  ) {
    return this.ymsService.getPositions(req.user.tenantId, block, yardId);
  }

  // ── Mouvements ────────────────────────────────────────────────────────────

  @Get('movements')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listMovements(
    @Request() req: AuthRequest,
    @Query('type') type?: YardMovementType,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.ymsService.listMovements(req.user.tenantId, {
      type,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }
}
