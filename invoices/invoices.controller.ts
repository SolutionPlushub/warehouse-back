import {
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
import { InvoicesService } from './invoices.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { DexDecideInvoiceDto } from './dto/dex-decide-invoice.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms/shipments/:fileId/invoice')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.DEX,
    UserRole.CUSTOMS,
  )
  getByFile(
    @Param('fileId') fileId: string,
    @Query('vat') vat: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.invoicesService.getByFile(
      fileId,
      req.user.tenantId,
      vat === undefined ? undefined : vat !== 'false',
    );
  }

  @Post('issue')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  issue(
    @Param('fileId') fileId: string,
    @Query('vat') vat: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.invoicesService.issue(
      fileId,
      req.user.tenantId,
      vat === undefined ? undefined : vat !== 'false',
    );
  }

  // Réémission d'une facture déjà émise (jamais payée) — recalcule les
  // totaux à partir des lignes actuelles. Réservée ADMIN/DEX (pas AGENT,
  // contrairement à la première émission) car ça corrige un document déjà
  // officiel, potentiellement déjà transmis au client.
  @Post('reissue')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  reissue(
    @Param('fileId') fileId: string,
    @Query('vat') vat: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.invoicesService.reissue(
      fileId,
      req.user.tenantId,
      vat === undefined ? undefined : vat !== 'false',
    );
  }

  @Patch('mark-paid')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  markPaid(@Param('fileId') fileId: string, @Request() req: AuthRequest) {
    return this.invoicesService.markPaid(fileId, req.user.tenantId);
  }

  // Validation DEX (préalable à toute sortie §15) — réservée DEX/ADMIN du
  // tenant, distincte de la validation DEX sur Operation.
  @Patch('validate-dex')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  validateDex(
    @Param('fileId') fileId: string,
    @Body() dto: DexDecideInvoiceDto,
    @Request() req: AuthRequest,
  ) {
    return this.invoicesService.validateDex(
      fileId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  @Patch('reject-dex')
  @Roles(UserRole.ADMIN, UserRole.DEX)
  rejectDex(
    @Param('fileId') fileId: string,
    @Body() dto: DexDecideInvoiceDto,
    @Request() req: AuthRequest,
  ) {
    return this.invoicesService.rejectDex(
      fileId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }
}
