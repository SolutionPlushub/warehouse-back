import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { WmsAiService } from './wms-ai.service';
import { BulkLinesDto } from './dto/bulk-lines.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@Controller('wms')
@UseGuards(JwtAccessGuard, RolesGuard)
export class WmsAiController {
  constructor(private readonly wmsAiService: WmsAiService) {}

  @Post('shipments/:fileId/lines/bulk')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  bulkCreateLines(
    @Param('fileId') fileId: string,
    @Body() dto: BulkLinesDto,
    @Request() req: AuthRequest,
  ) {
    return this.wmsAiService.bulkCreateLines(fileId, req.user.tenantId, dto.lines);
  }

  @Post('ai/ocr-bl')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 24 * 1024 * 1024 } }))
  ocrBL(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.wmsAiService.ocrBL(file.buffer, file.mimetype, req.user.tenantId);
  }

  @Post('ai/analyze-stock')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  analyzeStock(@Request() req: AuthRequest) {
    return this.wmsAiService.analyzeStock(req.user.tenantId);
  }

  @Post('ai/suggest-line')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  suggestLine(
    @Body() body: { packageRef: string },
    @Request() req: AuthRequest,
  ) {
    return this.wmsAiService.suggestLine(body.packageRef, req.user.tenantId);
  }
}
