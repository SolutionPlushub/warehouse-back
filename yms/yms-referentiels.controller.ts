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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { YmsReferentielsService } from './yms-referentiels.service';
import { CreateShippingLineRefDto } from './dto/create-shipping-line-ref.dto';
import { CreateContainerTypeRefDto } from './dto/create-container-type-ref.dto';
import {
  CreateYardBlockDefDto,
  UpdateYardBlockDefDto,
} from './dto/create-yard-block-def.dto';
import { CreatePreGateDto } from './dto/create-pregate.dto';
import { UpdatePreGateDto } from './dto/update-pregate.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('yms/referentiels')
export class YmsReferentielsController {
  constructor(private readonly svc: YmsReferentielsService) {}

  // ── Armateurs ────────────────────────────────────────────────────────────
  @Get('shipping-lines')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  listShippingLines(@Request() req: AuthRequest) {
    return this.svc.listShippingLines(req.user.tenantId);
  }

  @Post('shipping-lines')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  createShippingLine(
    @Request() req: AuthRequest,
    @Body() dto: CreateShippingLineRefDto,
  ) {
    return this.svc.createShippingLine(req.user.tenantId, dto);
  }

  @Patch('shipping-lines/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateShippingLine(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: Partial<CreateShippingLineRefDto>,
  ) {
    return this.svc.updateShippingLine(req.user.tenantId, id, dto);
  }

  @Delete('shipping-lines/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteShippingLine(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.deleteShippingLine(req.user.tenantId, id);
  }

  // ── Types conteneurs ─────────────────────────────────────────────────────
  @Get('container-types')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  listContainerTypes(@Request() req: AuthRequest) {
    return this.svc.listContainerTypes(req.user.tenantId);
  }

  @Post('container-types')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  createContainerType(
    @Request() req: AuthRequest,
    @Body() dto: CreateContainerTypeRefDto,
  ) {
    return this.svc.createContainerType(req.user.tenantId, dto);
  }

  @Patch('container-types/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateContainerType(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: Partial<CreateContainerTypeRefDto>,
  ) {
    return this.svc.updateContainerType(req.user.tenantId, id, dto);
  }

  @Delete('container-types/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteContainerType(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.deleteContainerType(req.user.tenantId, id);
  }

  // ── Blocs (YardBlockDef) ─────────────────────────────────────────────────
  @Get('blocks')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS, UserRole.DEX)
  listBlockDefs(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.svc.listBlockDefs(req.user.tenantId, yardId);
  }

  @Post('blocks')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  createBlockDef(
    @Request() req: AuthRequest,
    @Body() dto: CreateYardBlockDefDto,
  ) {
    return this.svc.createBlockDef(req.user.tenantId, dto);
  }

  @Patch('blocks/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateBlockDef(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateYardBlockDefDto,
  ) {
    return this.svc.updateBlockDef(req.user.tenantId, id, dto);
  }

  @Delete('blocks/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBlockDef(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.deleteBlockDef(req.user.tenantId, id);
  }

  // ── Pré-gates ─────────────────────────────────────────────────────────────
  @Get('pre-gates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  listPreGates(@Request() req: AuthRequest, @Query('yardId') yardId?: string) {
    return this.svc.listPreGates(req.user.tenantId, yardId);
  }

  @Get('pre-gates/scan/:containerNumber')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  scanContainer(
    @Request() req: AuthRequest,
    @Param('containerNumber') containerNumber: string,
  ) {
    return this.svc.scanContainer(req.user.tenantId, containerNumber);
  }

  @Get('pre-gates/search/:q')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  searchExpectedContainers(
    @Request() req: AuthRequest,
    @Param('q') q: string,
  ) {
    return this.svc.searchExpectedContainers(req.user.tenantId, q);
  }

  @Get('pre-gates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  getPreGate(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.getPreGate(req.user.tenantId, id);
  }

  @Post('pre-gates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  createPreGate(@Request() req: AuthRequest, @Body() dto: CreatePreGateDto) {
    return this.svc.createPreGate(req.user.tenantId, dto);
  }

  @Patch('pre-gates/:id/close')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  closePreGate(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.closePreGate(req.user.tenantId, id);
  }

  @Patch('pre-gates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  updatePreGate(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePreGateDto,
  ) {
    return this.svc.updatePreGate(req.user.tenantId, id, dto);
  }

  @Delete('pre-gates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePreGate(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.svc.deletePreGate(req.user.tenantId, id);
  }
}
