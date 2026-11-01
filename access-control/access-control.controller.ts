import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccessControlService } from './access-control.service';
import {
  CreateAccessRoleDto,
  DuplicateRoleDto,
  SetRolePermissionsDto,
  SetUserAccessDto,
  UpdateAccessRoleDto,
} from './dto/access.dto';

interface Caller {
  id: string;
  role: string;
  tenantId: string | null;
}

@ApiTags('Access')
@ApiCookieAuth('cookie-auth')
@ApiBearerAuth('bearer-auth')
@Controller('access')
@UseGuards(JwtAccessGuard, RolesGuard)
export class AccessControlController {
  constructor(private readonly access: AccessControlService) {}

  @Get('permissions')
  listPermissions() {
    return this.access.listPermissions();
  }

  @Get('roles')
  listRoles(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: Caller,
  ) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : (user.tenantId ?? undefined);
    return this.access.listRoles(tid);
  }

  @Post('roles')
  createRole(@Body() dto: CreateAccessRoleDto, @CurrentUser() user: Caller) {
    return this.access.createRole(user, dto);
  }

  @Put('roles/:id')
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAccessRoleDto,
    @CurrentUser() user: Caller,
  ) {
    return this.access.updateRole(user, id, dto);
  }

  @Put('roles/:id/permissions')
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: Caller,
  ) {
    return this.access.setRolePermissions(user, id, dto.permissionCodes);
  }

  @Post('roles/:id/reset-defaults')
  resetDefaults(@Param('id') id: string, @CurrentUser() user: Caller) {
    return this.access.resetRoleDefaults(user, id);
  }

  @Post('roles/:id/duplicate')
  duplicate(
    @Param('id') id: string,
    @Body() dto: DuplicateRoleDto,
    @CurrentUser() user: Caller,
  ) {
    return this.access.duplicateRole(user, id, dto.tenantId);
  }

  @Delete('roles/:id')
  removeRole(@Param('id') id: string, @CurrentUser() user: Caller) {
    return this.access.deleteRole(user, id);
  }

  @Get('me')
  me(@CurrentUser() user: Caller) {
    return this.access.effective(user.id, user.role);
  }

  @Get('users/:userId')
  getUserAccess(@Param('userId') userId: string, @CurrentUser() user: Caller) {
    return this.access.getUserAccess(user, userId);
  }

  @Put('users/:userId')
  setUserAccess(
    @Param('userId') userId: string,
    @Body() dto: SetUserAccessDto,
    @CurrentUser() user: Caller,
  ) {
    return this.access.setUserAccess(user, userId, dto);
  }
}
