import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TransshipmentService } from './transshipment.service';
import {
  CarrierExitDto,
  ReceiverGateInDto,
  TransshipExitDto,
} from './dto/transshipment.dto';

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

// Transbordement d'un dossier : porteurs, camions récepteurs, sorties.
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms/shipments/:fileId/transshipment')
export class TransshipmentController {
  constructor(private readonly transshipment: TransshipmentService) {}

  @Get()
  @Roles(...READERS)
  overview(@Param('fileId') fileId: string, @Request() req: AuthRequest) {
    return this.transshipment.overview(fileId, req.user.tenantId);
  }

  @Post('receivers')
  @Roles(...WRITERS)
  receiverGateIn(
    @Param('fileId') fileId: string,
    @Request() req: AuthRequest,
    @Body() dto: ReceiverGateInDto,
  ) {
    return this.transshipment.receiverGateIn(
      fileId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Patch('receivers/:visitId/exit')
  @Roles(...WRITERS)
  receiverExit(
    @Param('fileId') fileId: string,
    @Param('visitId') visitId: string,
    @Request() req: AuthRequest,
    @Body() dto: TransshipExitDto,
  ) {
    return this.transshipment.receiverExit(
      fileId,
      req.user.tenantId,
      req.user.id,
      req.user.role,
      visitId,
      dto,
    );
  }

  @Post('carrier-exit')
  @Roles(...WRITERS)
  carrierExit(
    @Param('fileId') fileId: string,
    @Request() req: AuthRequest,
    @Body() dto: CarrierExitDto,
  ) {
    return this.transshipment.carrierExit(
      fileId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }
}
