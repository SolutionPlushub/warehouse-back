import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SetDefaultYardDto } from './dto/set-default-yard.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

const USER_EXAMPLE = {
  id: 'clxyz123',
  email: 'k.benali@dmt.sn',
  firstName: 'Karim',
  lastName: 'Benali',
  role: 'AGENT',
  isActive: true,
  lastLoginAt: '2026-05-18T08:00:00.000Z',
  createdAt: '2026-01-12T00:00:00.000Z',
  tenantId: 'clxyz456',
  tenant: {
    id: 'clxyz456',
    name: 'DMT Hub Logistique Dakar',
    slug: 'dmt-dakar',
    brandColor: '#0050A0',
  },
};

@ApiTags('Users')
@ApiCookieAuth('cookie-auth')
@ApiBearerAuth('bearer-auth')
@Controller('users')
@UseGuards(JwtAccessGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  // ── GET /users ────────────────────────────────────────────────────────────

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: "Lister les utilisateurs d'un tenant",
    description:
      'SUPER_ADMIN : passer `?tenantId=xxx` pour filtrer. ADMIN : retourne uniquement les utilisateurs de son tenant.',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'ID du tenant (SUPER_ADMIN uniquement)',
    example: 'clxyz456',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste des utilisateurs',
    schema: { example: [USER_EXAMPLE] },
  })
  findAll(
    @Query('tenantId') tenantId: string,
    @CurrentUser() user: { role: UserRole; tenantId: string | null },
  ) {
    const tid =
      user.role === UserRole.SUPER_ADMIN
        ? tenantId
        : (user.tenantId ?? tenantId);
    return this.users.findAllByTenant(tid);
  }

  // ── PATCH /users/me/default-yard ─────────────────────────────────────────

  @Patch('me/default-yard')
  @ApiOperation({
    summary: 'Définir le yard par défaut de l\'utilisateur courant',
    description:
      'Pré-sélectionne ce yard dans les écrans YMS avec un filtre par yard (dashboard, plan du yard, formulaires gate-in/pré-gate). Passer `yardId: null` pour retirer la préférence.',
  })
  @ApiResponse({ status: 200, description: 'Préférence enregistrée', schema: { example: USER_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Yard introuvable pour ce tenant' })
  setMyDefaultYard(
    @Body() dto: SetDefaultYardDto,
    @CurrentUser() user: { id: string; tenantId: string | null },
  ) {
    return this.users.setDefaultYard(user.id, user.tenantId, dto.yardId ?? null);
  }

  // ── GET /users/:id ────────────────────────────────────────────────────────

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: "Détail d'un utilisateur" })
  @ApiParam({
    name: 'id',
    description: "ID de l'utilisateur",
    example: 'clxyz123',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur trouvé',
    schema: { example: USER_EXAMPLE },
  })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable' })
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  // ── POST /users ───────────────────────────────────────────────────────────

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Inviter un utilisateur',
    description:
      "Crée un compte inactif et envoie un e-mail d'invitation (lien de confirmation valable 48h). L'utilisateur devra définir son mot de passe pour activer son compte.",
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation envoyée — compte créé en attente de confirmation',
    schema: { example: { ...USER_EXAMPLE, isActive: false } },
  })
  @ApiResponse({ status: 409, description: 'Cet e-mail est déjà utilisé' })
  invite(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: { role: UserRole; tenantId: string | null },
  ) {
    if (user.role === UserRole.ADMIN) dto.tenantId = user.tenantId ?? undefined;
    return this.users.invite(dto);
  }

  // ── PATCH /users/:id/toggle ───────────────────────────────────────────────

  @Patch(':id/toggle')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Activer / Désactiver un utilisateur',
    description:
      'Bascule `isActive`. Un utilisateur désactivé ne peut plus se connecter.',
  })
  @ApiParam({
    name: 'id',
    description: "ID de l'utilisateur",
    example: 'clxyz123',
  })
  @ApiResponse({
    status: 200,
    description: 'Statut basculé',
    schema: { example: { ...USER_EXAMPLE, isActive: false } },
  })
  toggle(@Param('id') id: string) {
    return this.users.toggle(id);
  }

  // ── PATCH /users/:id ──────────────────────────────────────────────────────

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Modifier un utilisateur',
    description: "Met à jour le prénom, nom et/ou le rôle d'un utilisateur.",
  })
  @ApiParam({
    name: 'id',
    description: "ID de l'utilisateur",
    example: 'clxyz123',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur mis à jour',
    schema: { example: USER_EXAMPLE },
  })
  update(@Param('id') id: string, @Body() body: Partial<CreateUserDto>) {
    return this.users.update(id, body);
  }

  // ── POST /users/:id/reset-password ───────────────────────────────────────

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Envoyer un lien de réinitialisation de mot de passe',
    description:
      "Génère un token PASSWORD_RESET valable 1h et envoie un e-mail à l'utilisateur.",
  })
  @ApiParam({ name: 'id', description: "ID de l'utilisateur" })
  @ApiResponse({ status: 204, description: 'E-mail envoyé' })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable' })
  sendPasswordReset(@Param('id') id: string) {
    return this.users.sendPasswordReset(id);
  }

  // ── POST /users/:id/set-password ─────────────────────────────────────────

  @Post(':id/set-password')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Définir directement le mot de passe',
    description:
      'Définit un nouveau mot de passe sans passer par e-mail. Active le compte si inactif. Invalide toutes les sessions actives.',
  })
  @ApiParam({ name: 'id', description: "ID de l'utilisateur" })
  @ApiResponse({ status: 204, description: 'Mot de passe mis à jour' })
  @ApiResponse({ status: 400, description: 'Mot de passe trop court' })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable' })
  setPassword(@Param('id') id: string, @Body('password') password: string) {
    return this.users.setPassword(id, password);
  }

  // ── DELETE /users/:id ─────────────────────────────────────────────────────

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Supprimer un utilisateur',
    description:
      'Supprime définitivement un utilisateur et ses tokens. Irréversible.',
  })
  @ApiParam({
    name: 'id',
    description: "ID de l'utilisateur",
    example: 'clxyz123',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur supprimé',
    schema: { example: { id: 'clxyz123' } },
  })
  @ApiResponse({ status: 404, description: 'Utilisateur introuvable' })
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  // ── PATCH /users/:id/modules ──────────────────────────────────────────────

  @Patch(':id/modules')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: "Définir les modules accessibles d'un utilisateur",
    description:
      'Remplace la liste complète des modules autorisés pour cet utilisateur.',
  })
  @ApiParam({ name: 'id', description: "ID de l'utilisateur" })
  @ApiResponse({ status: 200, description: 'Modules mis à jour' })
  setModules(@Param('id') id: string, @Body('modules') modules: string[]) {
    return this.users.setModules(id, modules ?? []);
  }
}
