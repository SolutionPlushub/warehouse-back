import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OperationsService } from './operations.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateOperationDto } from './dto/create-operation.dto';
import { DecideOperationDto } from './dto/decide-operation.dto';
import { AdvanceOperationDto } from './dto/advance-operation.dto';
import { RewindOperationDto } from './dto/rewind-operation.dto';
import { CapacityReservationDto } from './dto/capacity-reservation.dto';
import { EntryAuthorizationDto } from './dto/entry-authorization.dto';
import { EmailEntryPassDto } from './dto/email-entry-pass.dto';
import { GateInPassDto } from './dto/gate-in-pass.dto';
import { UpdateGatePassDto } from './dto/update-gate-pass.dto';
import { InspectUnitDto } from './dto/inspect-unit.dto';
import {
  SlotChangeRequestDto,
  DecideSlotChangeDto,
} from './dto/slot-change-request.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms/shipments/:fileId/operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  findByFile(@Param('fileId') fileId: string, @Request() req: AuthRequest) {
    return this.operationsService.findByFile(fileId, req.user.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  create(
    @Param('fileId') fileId: string,
    @Body() dto: CreateOperationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.create(fileId, req.user.tenantId, dto);
  }

  @Patch(':operationId/close')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  close(
    @Param('operationId') operationId: string,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.close(operationId, req.user.tenantId);
  }

  // ── Validation hiérarchique N+1 (opération initiale par défaut, ou une
  //    opération précise via operationId dans le body — voir
  //    OperationsService.submit()) ──────────────────────────────────────────

  @Post('submit')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  submit(
    @Param('fileId') fileId: string,
    @Body() body: { operationId?: string } | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.submit(
      fileId,
      req.user.tenantId,
      req.user.id,
      body?.operationId,
    );
  }

  @Patch(':operationId/validate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  validate(
    @Param('operationId') operationId: string,
    @Body() dto: DecideOperationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.validate(
      operationId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Patch(':operationId/reject')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  reject(
    @Param('operationId') operationId: string,
    @Body() dto: DecideOperationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.reject(
      operationId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Patch(':operationId/reopen')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  reopen(
    @Param('operationId') operationId: string,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.reopen(operationId, req.user.tenantId);
  }

  // ── Avancement par unité à travers le pipeline d'étapes ──────────────────

  @Delete(':operationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  removeOperation(
    @Param('fileId') fileId: string,
    @Param('operationId') operationId: string,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.removeOperation(
      fileId,
      operationId,
      req.user.tenantId,
    );
  }

  @Patch(':operationId/advance')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  advance(
    @Param('operationId') operationId: string,
    @Body() dto: AdvanceOperationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.advance(
      operationId,
      req.user.tenantId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  // Retour à l'étape précédente (correction de saisie) — DEX/ADMIN, motif
  // obligatoire, contrôles d'irréversibilité dans le service.
  @Patch(':operationId/rewind')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  rewind(
    @Param('operationId') operationId: string,
    @Body() dto: RewindOperationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.rewind(
      operationId,
      req.user.tenantId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  // ── Réservation de capacité, BAE, Gate In, inspection ────────────────────

  @Patch(':operationId/capacity')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  reserveCapacity(
    @Param('operationId') operationId: string,
    @Body() dto: CapacityReservationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.reserveCapacity(
      operationId,
      req.user.tenantId,
      dto,
    );
  }

  @Post(':operationId/entry-authorization')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  authorizeEntry(
    @Param('operationId') operationId: string,
    @Body() dto: EntryAuthorizationDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.authorizeEntry(
      operationId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Post(':operationId/entry-pass/email')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  emailEntryPass(
    @Param('operationId') operationId: string,
    @Body() dto: EmailEntryPassDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.emailEntryPass(
      operationId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Patch(':operationId/documents-check')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  validateDocuments(
    @Param('operationId') operationId: string,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.validateDocuments(
      operationId,
      req.user.tenantId,
    );
  }

  @Post(':operationId/gate-in')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateIn(
    @Param('operationId') operationId: string,
    @Body() dto: GateInPassDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.gateIn(
      operationId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  // Correction d'un passage Gate In déjà enregistré (date/heure) — réservée
  // à un rôle habilité à corriger l'audit (pas AGENT, pour éviter des
  // corrections non tracées d'un passage déjà validé par un tiers).
  @Patch(':operationId/gate-passes/:passId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  updateGatePass(
    @Param('passId') passId: string,
    @Body() dto: UpdateGatePassDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.updateGatePass(
      passId,
      req.user.tenantId,
      dto,
    );
  }

  @Post(':operationId/lines/:operationLineId/inspection')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  inspectUnit(
    @Param('operationLineId') operationLineId: string,
    @Body() dto: InspectUnitDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.inspectUnit(
      operationLineId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  // ── Changement d'emplacement : demande + décision ────────────────────────

  @Post(':operationId/lines/:operationLineId/slot-change-request')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  requestSlotChange(
    @Param('operationLineId') operationLineId: string,
    @Body() dto: SlotChangeRequestDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.requestSlotChange(
      operationLineId,
      req.user.tenantId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  @Patch(':operationId/slot-change-approvals/:approvalId/decide')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  decideSlotChange(
    @Param('approvalId') approvalId: string,
    @Body() dto: DecideSlotChangeDto,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.decideSlotChange(
      approvalId,
      req.user.tenantId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  // Validation DEX (flag minimal — voir note dans operations.service.ts).
  // Réservée à un rôle DEX/hiérarchique, comme validate/reject du N+1.
  @Patch(':operationId/validate-dex')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  validateDex(
    @Param('operationId') operationId: string,
    @Request() req: AuthRequest,
  ) {
    return this.operationsService.validateDex(
      operationId,
      req.user.tenantId,
      req.user.id,
    );
  }
}
