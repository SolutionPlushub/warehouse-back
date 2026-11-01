import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GateRegistryService } from '../tms/gate-registry.service';
import { TruckLoadsService } from './truck-loads.service';
import {
  CreateTruckLoadDto,
  TruckLoadDeliverDto,
  TruckLoadGateOutDto,
} from './dto/truck-load.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

const READERS = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.AGENT,
  UserRole.CUSTOMS,
  UserRole.DEX,
];
const WRITERS = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.AGENT,
  UserRole.DEX,
];

// Registre Gate (camions sur site) et chargements camion partiels.
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('ops')
export class TruckLoadsController {
  constructor(
    private readonly truckLoads: TruckLoadsService,
    private readonly gateRegistry: GateRegistryService,
  ) {}

  @Get('gate-trucks')
  @Roles(...READERS)
  listGateTrucks(@Request() req: AuthRequest, @Query('q') q?: string) {
    return this.gateRegistry.list(req.user.tenantId, q);
  }

  @Get('truck-loads')
  @Roles(...READERS)
  listTruckLoads(
    @Request() req: AuthRequest,
    @Query('status') status?: string,
  ) {
    return this.truckLoads.list(req.user.tenantId, status);
  }

  @Get('truck-loads/candidates')
  @Roles(...READERS)
  listTruckLoadCandidates(@Request() req: AuthRequest) {
    return this.truckLoads.candidates(req.user.tenantId);
  }

  @Post('truck-loads')
  @Roles(...WRITERS)
  createTruckLoad(@Request() req: AuthRequest, @Body() dto: CreateTruckLoadDto) {
    return this.truckLoads.create(req.user.tenantId, req.user.id, dto);
  }

  @Patch('truck-loads/:id/gate-out')
  @Roles(...WRITERS)
  truckLoadGateOut(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: TruckLoadGateOutDto,
  ) {
    return this.truckLoads.gateOut(
      req.user.tenantId,
      id,
      dto,
      req.user.id,
      req.user.role,
    );
  }

  @Patch('truck-loads/:id/gate-out-date')
  @Roles(...WRITERS)
  truckLoadGateOutDate(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: TruckLoadGateOutDto,
  ) {
    if (!dto.gateOutAt)
      throw new BadRequestException('Indiquez la date de sortie.');
    return this.truckLoads.updateGateOutDate(req.user.tenantId, id, dto.gateOutAt);
  }

  @Patch('truck-loads/:id/deliver')
  @Roles(...WRITERS)
  truckLoadDeliver(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: TruckLoadDeliverDto,
  ) {
    return this.truckLoads.deliver(req.user.tenantId, id, dto);
  }

  @Patch('truck-loads/:id/cancel')
  @Roles(...WRITERS)
  cancelTruckLoad(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.truckLoads.cancel(req.user.tenantId, id);
  }
}
