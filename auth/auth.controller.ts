import { Throttle } from '@nestjs/throttler';
import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // ── POST /auth/login ─────────────────────────────────────────────────────

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion',
    description:
      'Pose les cookies httpOnly `access_token` (15 min) et `refresh_token` (7 j). ' +
      'Retourne uniquement un message de confirmation. ' +
      'Le profil utilisateur est disponible sur **GET /auth/me**.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description:
      'Connexion réussie. ' +
      '`accessToken` à stocker en mémoire (pas localStorage). ' +
      '`csrfToken` à renvoyer dans le header `X-CSRF-Token` à chaque appel `/auth/refresh`. ' +
      'Cookie httpOnly `refresh_token` posé automatiquement.',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        tokenType: 'Bearer',
        expiresIn: 900,
        csrfToken: 'a3f8e2c1d4b7...',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Identifiants incorrects ou compte inactif',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(dto.email, dto.password, res);
  }

  // ── POST /auth/refresh ───────────────────────────────────────────────────

  @Post('refresh')
  @UseGuards(CsrfGuard, JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('cookie-auth')
  @ApiOperation({
    summary: 'Renouveler les tokens',
    description:
      'Utilise le cookie `refresh_token` pour émettre de nouveaux tokens (rotation). ' +
      "L'ancien refresh token est invalidé. " +
      'Requiert le header **`X-CSRF-Token`** avec la valeur reçue au login (OWASP A05).',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens renouvelés — nouvel accessToken dans le body',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        tokenType: 'Bearer',
        expiresIn: 900,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalide, expiré ou déjà utilisé',
  })
  async refresh(
    @CurrentUser() user: User & { tokenId: string; rawRefreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(user, res);
  }

  // ── POST /auth/logout ────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('cookie-auth')
  @ApiBearerAuth('bearer-auth')
  @ApiOperation({
    summary: 'Déconnexion',
    description:
      'Invalide tous les refresh tokens actifs et supprime les cookies.',
  })
  @ApiResponse({ status: 204, description: 'Déconnecté' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(userId, res);
  }

  // ── GET /auth/me ─────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAccessGuard)
  @ApiCookieAuth('cookie-auth')
  @ApiBearerAuth('bearer-auth')
  @ApiOperation({
    summary: 'Profil courant',
    description:
      "Retourne le profil complet de l'utilisateur connecté avec les infos du tenant.",
  })
  @ApiResponse({
    status: 200,
    description: 'Profil utilisateur',
    schema: {
      example: {
        id: 'clxyz123',
        email: 'admin@dmt.sn',
        firstName: 'Aminata',
        lastName: 'Diop',
        role: 'ADMIN',
        isActive: true,
        tenantId: 'clxyz456',
        lastLoginAt: '2026-05-18T10:30:00.000Z',
        createdAt: '2026-01-12T00:00:00.000Z',
        tenant: {
          id: 'clxyz456',
          name: 'DMT Hub Logistique Dakar',
          slug: 'dmt-dakar',
          type: 'OPERATOR',
          plan: 'Enterprise',
          brandColor: '#0050A0',
          brandInitials: 'DMT',
          brandTagline: 'Hub Logistique Portuaire',
          brandLogoText: 'DMT Hub',
          site: 'ICD Dakar — Port Autonome',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token expiré ou invalide' })
  async me(@CurrentUser('id') userId: string) {
    return this.auth.me(userId);
  }

  // ── POST /auth/forgot-password ───────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mot de passe oublié',
    description:
      'Envoie un e-mail de réinitialisation (via Resend). Répond toujours 200 ' +
      "même si le compte n'existe pas (anti-énumération OWASP A07). Lien valable **1 heure**.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Réponse identique quelle que soit l'existence du compte",
    schema: {
      example: {
        message:
          'Si un compte existe, un e-mail de réinitialisation a été envoyé.',
      },
    },
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      message:
        'Si un compte existe, un e-mail de réinitialisation a été envoyé.',
    };
  }

  // ── POST /auth/reset-password ────────────────────────────────────────────

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser le mot de passe',
    description:
      'Valide le token (usage unique, 1h) et met à jour le mot de passe. ' +
      'Invalide toutes les sessions actives.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé',
    schema: { example: { message: 'Mot de passe réinitialisé avec succès.' } },
  })
  @ApiResponse({ status: 400, description: 'Token invalide ou expiré' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  // ── POST /auth/confirm-account ───────────────────────────────────────────

  @Post('confirm-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activer un compte (invitation)',
    description:
      "Active le compte d'un utilisateur invité et définit son mot de passe. " +
      'Token valable **48 heures**, usage unique.',
  })
  @ApiBody({ type: ConfirmAccountDto })
  @ApiResponse({
    status: 200,
    description: 'Compte activé',
    schema: {
      example: {
        message: 'Compte activé avec succès. Vous pouvez vous connecter.',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Token invalide ou expiré' })
  async confirmAccount(@Body() dto: ConfirmAccountDto) {
    await this.auth.confirmAccount(dto.token, dto.password);
    return {
      message: 'Compte activé avec succès. Vous pouvez vous connecter.',
    };
  }

  // ── POST /auth/change-password ───────────────────────────────────────────

  @Post('change-password')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('cookie-auth')
  @ApiBearerAuth('bearer-auth')
  @ApiOperation({
    summary: 'Changer son mot de passe',
    description:
      'Vérifie le mot de passe actuel et met à jour. ' +
      'Invalide toutes les autres sessions actives (OWASP A02).',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe modifié',
    schema: { example: { message: 'Mot de passe modifié avec succès.' } },
  })
  @ApiResponse({ status: 401, description: 'Mot de passe actuel incorrect' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Mot de passe modifié avec succès.' };
  }
}
