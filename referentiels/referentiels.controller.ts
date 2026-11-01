import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReferentielsService } from './referentiels.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import {
  UpsertStorageRegimeDto,
  UpsertShipmentTypeDto,
  UpsertPackageTypeDto,
  UpsertStorageZoneDto,
  UpsertCarrierDto,
  UpsertEquipmentDto,
  CreateTariffDto,
  UpdateTariffDto,
} from './dto/upsert-ref.dto';
import {
  UpsertYardDto,
  PatchYardStackingRulesDto,
} from './dto/upsert-yard.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('referentiels')
export class ReferentielsController {
  constructor(private readonly svc: ReferentielsService) {}

  // ── Lecture groupée (formulaires) ────────────────────────────────────────

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  getAll(@Request() req: AuthRequest) {
    return this.svc.getAll(req.user.tenantId);
  }

  // ── Storage Regimes ──────────────────────────────────────────────────────

  @Get('storage-regimes')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listRegimes(@Request() req: AuthRequest) {
    return this.svc.listStorageRegimes(req.user.tenantId);
  }

  @Post('storage-regimes')
  @Roles(UserRole.ADMIN)
  upsertRegime(
    @Request() req: AuthRequest,
    @Body() dto: UpsertStorageRegimeDto,
  ) {
    return this.svc.upsertStorageRegime(req.user.tenantId, dto);
  }

  @Delete('storage-regimes/:code')
  @Roles(UserRole.ADMIN)
  deleteRegime(@Request() req: AuthRequest, @Param('code') code: string) {
    return this.svc.deleteStorageRegime(req.user.tenantId, code);
  }

  // ── Shipment Types ───────────────────────────────────────────────────────

  @Get('shipment-types')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listShipTypes(@Request() req: AuthRequest) {
    return this.svc.listShipmentTypes(req.user.tenantId);
  }

  @Post('shipment-types')
  @Roles(UserRole.ADMIN)
  upsertShipType(
    @Request() req: AuthRequest,
    @Body() dto: UpsertShipmentTypeDto,
  ) {
    return this.svc.upsertShipmentType(req.user.tenantId, dto);
  }

  @Delete('shipment-types/:code')
  @Roles(UserRole.ADMIN)
  deleteShipType(@Request() req: AuthRequest, @Param('code') code: string) {
    return this.svc.deleteShipmentType(req.user.tenantId, code);
  }

  // ── Package Types ────────────────────────────────────────────────────────

  @Get('package-types')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listPkgTypes(@Request() req: AuthRequest) {
    return this.svc.listPackageTypes(req.user.tenantId);
  }

  @Post('package-types')
  @Roles(UserRole.ADMIN)
  upsertPkgType(
    @Request() req: AuthRequest,
    @Body() dto: UpsertPackageTypeDto,
  ) {
    return this.svc.upsertPackageType(req.user.tenantId, dto);
  }

  @Delete('package-types/:code')
  @Roles(UserRole.ADMIN)
  deletePkgType(@Request() req: AuthRequest, @Param('code') code: string) {
    return this.svc.deletePackageType(req.user.tenantId, code);
  }

  // ── Yards / Entrepôts ────────────────────────────────────────────────────

  @Get('yards')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS, UserRole.DEX)
  listYards(@Request() req: AuthRequest) {
    return this.svc.listYards(req.user.tenantId);
  }

  @Post('yards')
  @Roles(UserRole.ADMIN)
  upsertYard(@Request() req: AuthRequest, @Body() dto: UpsertYardDto) {
    return this.svc.upsertYard(req.user.tenantId, dto);
  }

  @Patch('yards/:code/stacking-rules')
  @Roles(UserRole.ADMIN)
  patchYardStackingRules(
    @Request() req: AuthRequest,
    @Param('code') code: string,
    @Body() dto: PatchYardStackingRulesDto,
  ) {
    return this.svc.patchYardStackingRules(
      req.user.tenantId,
      code,
      dto.stackingRules,
    );
  }

  @Delete('yards/:code')
  @Roles(UserRole.ADMIN)
  deleteYard(@Request() req: AuthRequest, @Param('code') code: string) {
    return this.svc.deleteYard(req.user.tenantId, code);
  }

  // ── Storage Zones ────────────────────────────────────────────────────────

  @Get('storage-zones')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listZones(@Request() req: AuthRequest) {
    return this.svc.listStorageZones(req.user.tenantId);
  }

  @Post('storage-zones')
  @Roles(UserRole.ADMIN)
  upsertZone(@Request() req: AuthRequest, @Body() dto: UpsertStorageZoneDto) {
    return this.svc.upsertStorageZone(req.user.tenantId, dto);
  }

  @Delete('storage-zones/:code')
  @Roles(UserRole.ADMIN)
  deleteZone(
    @Request() req: AuthRequest,
    @Param('code') code: string,
    @Query('yardId') yardId: string,
  ) {
    return this.svc.deleteStorageZone(req.user.tenantId, code, yardId);
  }

  // ── Seed données par défaut ──────────────────────────────────────────────

  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  seedDefaults(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.svc.seedDefaults(req.user.tenantId, yardId);
  }

  // ── Transporteurs — créable à la volée depuis le Gate ────────────────────

  @Get('carriers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listCarriers(@Request() req: AuthRequest) {
    return this.svc.listCarriers(req.user.tenantId);
  }

  @Post('carriers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  addCarrier(@Request() req: AuthRequest, @Body() dto: UpsertCarrierDto) {
    return this.svc.addCarrier(req.user.tenantId, dto);
  }

  @Patch('carriers/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateCarrier(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpsertCarrierDto,
  ) {
    return this.svc.updateCarrier(req.user.tenantId, id, dto);
  }

  @Delete('carriers/:id')
  @Roles(UserRole.ADMIN)
  removeCarrier(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.removeCarrier(req.user.tenantId, id);
  }

  // ── Engins de manutention ────────────────────────────────────────────────

  @Get('equipment')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listEquipment(@Request() req: AuthRequest) {
    return this.svc.listEquipment(req.user.tenantId);
  }

  @Post('equipment')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  addEquipment(@Request() req: AuthRequest, @Body() dto: UpsertEquipmentDto) {
    return this.svc.addEquipment(req.user.tenantId, dto);
  }

  @Patch('equipment/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateEquipment(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpsertEquipmentDto,
  ) {
    return this.svc.updateEquipment(req.user.tenantId, id, dto);
  }

  @Delete('equipment/:id')
  @Roles(UserRole.ADMIN)
  removeEquipment(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.removeEquipment(req.user.tenantId, id);
  }

  // ── Grille tarifaire ─────────────────────────────────────────────────────
  // CRUD référentiel pour TariffRef (jusqu'ici lu uniquement en interne par
  // InducedServicesService) — miroir de DosConfig.tariffs()/addTariff()/
  // updateTariff()/toggleTariffOp()/removeTariff() côté frontend.

  @Get('tariffs')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  listTariffs(
    @Request() req: AuthRequest,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.svc.listTariffs(req.user.tenantId, includeInactive === 'true');
  }

  @Post('tariffs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  createTariff(@Request() req: AuthRequest, @Body() dto: CreateTariffDto) {
    return this.svc.createTariff(req.user.tenantId, dto);
  }

  @Patch('tariffs/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateTariff(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTariffDto,
  ) {
    return this.svc.updateTariff(req.user.tenantId, id, dto);
  }

  @Delete('tariffs/:id')
  @Roles(UserRole.ADMIN)
  removeTariff(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.removeTariff(req.user.tenantId, id);
  }
}
