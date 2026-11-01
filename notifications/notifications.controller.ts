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
import { NotificationsService } from './notifications.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
} from './dto/upsert-template.dto';
import { SendNotificationDto } from './dto/send-notification.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ── Templates ────────────────────────────────────────────────────────────

  @Get('templates')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.DEX,
    UserRole.CUSTOMS,
  )
  listTemplates(@Request() req: AuthRequest) {
    return this.notificationsService.listTemplates(req.user.tenantId);
  }

  @Post('templates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  createTemplate(@Request() req: AuthRequest, @Body() dto: CreateTemplateDto) {
    return this.notificationsService.createTemplate(req.user.tenantId, dto);
  }

  @Patch('templates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateTemplate(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.notificationsService.updateTemplate(req.user.tenantId, id, dto);
  }

  @Delete('templates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  deleteTemplate(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.notificationsService.deleteTemplate(req.user.tenantId, id);
  }

  // ── Envoi ────────────────────────────────────────────────────────────────

  @Post('templates/:id/send')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT)
  send(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: SendNotificationDto,
  ) {
    return this.notificationsService.send(
      req.user.tenantId,
      id,
      req.user.id,
      dto,
    );
  }

  // ── Historique ───────────────────────────────────────────────────────────

  @Get('logs')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.AGENT,
    UserRole.DEX,
    UserRole.CUSTOMS,
  )
  listLogs(
    @Request() req: AuthRequest,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
  ) {
    return this.notificationsService.listLogs(req.user.tenantId, {
      channel,
      status,
    });
  }
}
