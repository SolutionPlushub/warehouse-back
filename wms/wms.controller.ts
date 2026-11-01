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
  UseInterceptors,
  UploadedFile,
  StreamableFile,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Readable } from 'node:stream';
import { WmsService } from './wms.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, ShipmentFileStatus } from '@prisma/client';
import { CreateShipmentFileDto } from './dto/create-shipment-file.dto';
import { CreateShipmentLineDto } from './dto/create-shipment-line.dto';
import { CreateExitMovementDto } from './dto/create-exit-movement.dto';
import { UpdateShipmentFileDto } from './dto/update-shipment-file.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { UpdateShipmentLineDto } from './dto/update-shipment-line.dto';
import { CustomsUpdateDto } from './dto/customs-update.dto';
import { ReceiveShipmentDto } from './dto/receive-shipment.dto';
import { PutawayConfirmDto } from './dto/putaway-confirm.dto';
import { ConfirmExitMovementDto } from './dto/confirm-exit-movement.dto';
import { BlockFileDto } from './dto/block-file.dto';
import { AddCargoDto } from './dto/add-cargo.dto';
import { UpdateCargoContainerDto } from './dto/update-cargo-container.dto';
import { ToggleDocumentDto } from './dto/toggle-document.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  // ── Clients ───────────────────────────────────────────────────────────────

  @Get('dashboard')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  getDashboard(@Request() req: AuthRequest) {
    return this.wmsService.getDashboardStats(req.user.tenantId);
  }

  @Get('clients')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.SUPER_ADMIN)
  listClients(@Request() req: AuthRequest) {
    return this.wmsService.listClients(req.user.tenantId);
  }

  @Post('clients')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createClient(
    @Body() dto: { name: string; site?: string; brandTagline?: string },
  ) {
    return this.wmsService.createClient(dto);
  }

  @Get('clients/:id')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.SUPER_ADMIN)
  getClient(@Param('id') id: string) {
    return this.wmsService.getClient(id);
  }

  @Patch('clients/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updateClient(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      site?: string;
      brandColor?: string;
      brandInitials?: string;
      brandTagline?: string;
    },
  ) {
    return this.wmsService.updateClient(id, dto);
  }

  @Delete('clients/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  deleteClient(@Param('id') id: string) {
    return this.wmsService.softDeleteClient(id);
  }

  // ── Allocations zones clients ─────────────────────────────────────────────

  @Get('client-zone-allocations')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.SUPER_ADMIN)
  listAllocations(
    @Request() req: AuthRequest,
    @Query('clientId') clientId?: string,
    @Query('zoneId') zoneId?: string,
  ) {
    return this.wmsService.listAllocations(req.user.tenantId, {
      clientId,
      zoneId,
    });
  }

  @Post('client-zone-allocations')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createAllocation(
    @Request() req: AuthRequest,
    @Body()
    dto: {
      clientId: string;
      zoneId: string;
      quotaM2?: number;
      isExclusive?: boolean;
      notes?: string;
    },
  ) {
    return this.wmsService.createAllocation(req.user.tenantId, dto);
  }

  @Patch('client-zone-allocations/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updateAllocation(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body()
    dto: { quotaM2?: number | null; isExclusive?: boolean; notes?: string },
  ) {
    return this.wmsService.updateAllocation(id, req.user.tenantId, dto);
  }

  @Delete('client-zone-allocations/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  deleteAllocation(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.deleteAllocation(id, req.user.tenantId);
  }

  // ── Shipment Files ────────────────────────────────────────────────────────

  @Get('shipments')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listFiles(
    @Request() req: AuthRequest,
    @Query('status') status?: ShipmentFileStatus,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('clientId') clientId?: string,
    @Query('dateField') dateField?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.wmsService.listFiles(req.user.tenantId, {
      status,
      search,
      clientId,
      dateField,
      from,
      to,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Post('shipments')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  createFile(@Request() req: AuthRequest, @Body() dto: CreateShipmentFileDto) {
    return this.wmsService.createFile(req.user.tenantId, dto, req.user.id);
  }

  // Vérification temps réel pendant la saisie (StepClientOps, Étape 1 du
  // wizard de création) — évite d'arriver au bout du wizard pour découvrir
  // au final que le code voyage existe déjà. Doit rester déclarée AVANT
  // 'shipments/:id' (route littérale prioritaire sur le paramétrique).
  @Get('shipments/check-voyage-code')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  checkVoyageCode(
    @Request() req: AuthRequest,
    @Query('voyageCode') voyageCode: string,
  ) {
    return this.wmsService.checkVoyageCodeAvailable(
      req.user.tenantId,
      voyageCode,
    );
  }

  @Get('shipments/:id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  getFile(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.getFile(id, req.user.tenantId);
  }

  @Patch('shipments/:id')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  updateFile(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateShipmentFileDto,
  ) {
    return this.wmsService.updateFile(id, req.user.tenantId, dto);
  }

  @Delete('shipments/:id')
  @Roles(UserRole.ADMIN)
  deleteFile(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.deleteFile(id, req.user.tenantId);
  }

  // Moyen de règlement (espèces/virement/chèque) — modifiable après création
  // depuis l'onglet Finance (TabFinance, dossier-finance.jsx), même pattern
  // que setVatApplicable côté frontend. Pilote le timbre fiscal (1% en
  // espèces, voir InvoicesService.computeTotals()).
  @Patch('shipments/:id/payment-method')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  updatePaymentMethod(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.wmsService.updatePaymentMethod(
      id,
      req.user.tenantId,
      dto.method,
    );
  }

  // Blocage comptable au niveau dossier — réservé DEX/ADMIN/SUPER_ADMIN.
  @Patch('shipments/:id/block')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  blockFile(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: BlockFileDto,
  ) {
    return this.wmsService.blockFile(id, req.user.tenantId, req.user.id, dto);
  }

  @Patch('shipments/:id/unblock')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEX)
  unblockFile(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.unblockFile(id, req.user.tenantId);
  }

  // Étape 2 — Suivi douanier
  @Patch('shipments/:id/customs')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  updateCustoms(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: CustomsUpdateDto,
  ) {
    return this.wmsService.updateCustoms(id, req.user.tenantId, dto);
  }

  // Étape 3 — Réception marchandise
  @Post('shipments/:id/receive')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  receiveShipment(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: ReceiveShipmentDto,
  ) {
    return this.wmsService.receiveShipment(id, req.user.tenantId, dto);
  }

  @Delete('receipts/:receiptId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  cancelReceipt(
    @Param('receiptId') receiptId: string,
    @Request() req: AuthRequest,
  ) {
    return this.wmsService.cancelReceipt(receiptId, req.user.tenantId);
  }

  // Étape 4 — Mise en place (gestionnaire de stock)
  @Patch('shipments/:id/putaway')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  confirmPutaway(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: PutawayConfirmDto,
  ) {
    return this.wmsService.confirmPutaway(
      id,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  // ── Lines ────────────────────────────────────────────────────────────────

  @Get('shipments/:id/lines')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  listLines(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.listLines(id, req.user.tenantId);
  }

  @Post('shipments/:id/lines')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  addLine(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: CreateShipmentLineDto,
  ) {
    return this.wmsService.addLine(id, req.user.tenantId, dto);
  }

  // Rattrape un dossier créé sans cargaison — voir WmsService.addCargo() pour
  // la garde de verrouillage (refusé si le Bon à Entrer est déjà émis).
  @Post('shipments/:id/cargo')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  addCargo(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: AddCargoDto,
  ) {
    return this.wmsService.addCargo(
      id,
      req.user.tenantId,
      req.user.id,
      dto,
      req.user.role,
    );
  }

  // Correction d'un conteneur du dossier (erreur de saisie) — voir
  // WmsService.updateCargoContainer() pour les règles par rôle.
  @Patch('shipments/:id/cargo/containers/:containerId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.DEX)
  updateCargoContainer(
    @Param('id') id: string,
    @Param('containerId') containerId: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateCargoContainerDto,
  ) {
    return this.wmsService.updateCargoContainer(
      id,
      containerId,
      req.user.tenantId,
      req.user.role,
      dto,
    );
  }

  @Get('shipments/:id/documents')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  listDocuments(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.listDocuments(id, req.user.tenantId);
  }

  @Post('shipments/:id/documents/:name/upload')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  uploadDocument(
    @Param('id') id: string,
    @Param('name') name: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ) {
    return this.wmsService.uploadDocument(
      id,
      req.user.tenantId,
      decodeURIComponent(name),
      req.user.id,
      file,
    );
  }

  @Post('shipments/:id/inspection/photos')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  uploadInspectionPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ) {
    return this.wmsService.uploadInspectionPhoto(
      id,
      req.user.tenantId,
      file,
    );
  }

  @Get('shipments/:id/inspection/photos/content')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  async downloadInspectionPhoto(
    @Param('id') id: string,
    @Query('blobName') blobName: string,
    @Request() req: AuthRequest,
  ) {
    const photo = await this.wmsService.downloadInspectionPhoto(
      id,
      req.user.tenantId,
      blobName,
    );
    return new StreamableFile(photo.stream as Readable, {
      type: photo.contentType || 'image/jpeg',
      length: photo.contentLength,
    });
  }

  @Get('shipments/:id/documents/:documentId/content')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.CLIENT,
  )
  async downloadDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Request() req: AuthRequest,
  ) {
    const document = await this.wmsService.downloadDocument(
      id,
      documentId,
      req.user.tenantId,
    );
    const encoded = encodeURIComponent(document.originalName || 'document');
    return new StreamableFile(document.stream as Readable, {
      type: document.mimeType || 'application/octet-stream',
      disposition: `inline; filename*=UTF-8''${encoded}`,
      length: document.sizeBytes || undefined,
    });
  }

  @Delete('shipments/:id/documents/:documentId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  deleteDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Request() req: AuthRequest,
  ) {
    return this.wmsService.deleteDocument(
      id,
      documentId,
      req.user.tenantId,
    );
  }

  @Get('shipments/:id/audit')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.CUSTOMS,
    UserRole.DEX,
  )
  listAudit(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.listAudit(id, req.user.tenantId);
  }

  @Patch('shipments/:id/documents/:name')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  toggleDocument(
    @Param('id') id: string,
    @Param('name') name: string,
    @Request() req: AuthRequest,
    @Body() dto: ToggleDocumentDto,
  ) {
    return this.wmsService.toggleDocument(
      id,
      req.user.tenantId,
      decodeURIComponent(name),
      dto.attached,
      req.user.id,
    );
  }

  @Patch('lines/:lineId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  updateLine(
    @Param('lineId') lineId: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateShipmentLineDto,
  ) {
    return this.wmsService.updateLine(lineId, req.user.tenantId, dto);
  }

  @Delete('lines/:lineId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  deleteLine(@Param('lineId') lineId: string, @Request() req: AuthRequest) {
    return this.wmsService.deleteLine(lineId, req.user.tenantId);
  }

  // ── Exit Movements ───────────────────────────────────────────────────────

  @Get('shipments/:id/exit-movements')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listExitMovements(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.listExitMovements(id, req.user.tenantId);
  }

  @Post('shipments/:id/exit-movements')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  createExitMovement(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: CreateExitMovementDto,
  ) {
    return this.wmsService.createExitMovement(id, req.user.tenantId, dto);
  }

  // Prorogation sommier
  @Patch('shipments/:id/extend-sommier')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  extendSommier(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.wmsService.extendSommier(id, req.user.tenantId, req.user.id);
  }

  // Confirme le bon (validation gestionnaire)
  @Patch('exit-movements/:movId/confirm')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  confirmExitMovement(
    @Param('movId') movId: string,
    @Request() req: AuthRequest,
    @Body() dto: ConfirmExitMovementDto,
  ) {
    return this.wmsService.confirmExitMovement(
      movId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  // Gate OUT physique (sortie effective du site)
  @Patch('exit-movements/:movId/gate-out')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  gateOutExitMovement(
    @Param('movId') movId: string,
    @Request() req: AuthRequest,
    @Body() dto: ConfirmExitMovementDto,
  ) {
    return this.wmsService.gateOutExitMovement(
      movId,
      req.user.tenantId,
      req.user.id,
      dto,
    );
  }

  // Déclaration douane export
  @Patch('exit-movements/:movId/customs-decl')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  updateExitCustomsDecl(
    @Param('movId') movId: string,
    @Request() req: AuthRequest,
    @Body('exitCustomsDecl') exitCustomsDecl: string,
  ) {
    return this.wmsService.updateExitCustomsDecl(
      movId,
      req.user.tenantId,
      exitCustomsDecl,
    );
  }

  // Liste globale des bons de sortie (tous dossiers confondus)
  @Get('exit-movements')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.CUSTOMS)
  listAllExitMovements(
    @Request() req: AuthRequest,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.wmsService.listAllExitMovements(req.user.tenantId, {
      status,
      search,
      skip: skip ? parseInt(skip) : undefined,
      take: take ? parseInt(take) : undefined,
    });
  }

  // Annulation d'un bon de sortie (DRAFT uniquement)
  @Delete('exit-movements/:movId')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  cancelExitMovement(
    @Param('movId') movId: string,
    @Request() req: AuthRequest,
  ) {
    return this.wmsService.cancelExitMovement(movId, req.user.tenantId);
  }
}
