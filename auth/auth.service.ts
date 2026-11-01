import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AccessControlService } from '../access-control/access-control.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import type { Response } from 'express';
import type { User } from '@prisma/client';

// ─── Constantes ─────────────────────────────────────────────────────────────
const AUTH_DELAY_MS = 300; // délai constant anti-timing-attack (OWASP A02)
const BCRYPT_ROUNDS = 12; // coût bcrypt recommandé OWASP
const ACCESS_TTL_S = 15 * 60; // 15 min
const REFRESH_TTL_S = 7 * 24 * 60 * 60; // 7 jours

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private access: AccessControlService,
  ) {}

  // ─── Login ────────────────────────────────────────────────────────────────
  // Stratégie hybride (deux containers Docker) :
  //   • accessToken  → retourné dans le body JSON, stocké en mémoire côté front
  //     (pas localStorage → immunisé XSS, pas de problème CORS)
  //   • refreshToken → cookie httpOnly SameSite=None (cross-origin),
  //     jamais exposé en JSON (OWASP A02)
  // Un token CSRF est aussi retourné pour protéger le refresh endpoint

  async login(email: string, password: string, res: Response) {
    const start = Date.now();

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Hash factice : délai constant même si l'user n'existe pas (OWASP A02)
    const hashToCompare =
      user?.passwordHash ??
      '$2b$12$invalidhashtopreventtimingattackXXXXXXXXXXXXXXXXXXXX';
    const pwdOk = await bcrypt.compare(password, hashToCompare);

    if (!user || !pwdOk || !user.isActive) {
      await this.enforceMinDelay(start);
      this.logger.warn(`[AUTH] Échec connexion : ${email}`);
      throw new UnauthorizedException(
        'Identifiants incorrects ou compte inactif.',
      );
    }

    const { accessToken, csrfToken } = await this.issueTokens(user, res);

    // lastLoginAt non bloquant (DDIA : pas critique pour la réponse)
    this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch((err) => this.logger.error('lastLoginAt update failed', err));

    await this.enforceMinDelay(start);
    this.logger.log(`[AUTH] Connexion réussie : ${user.email} (${user.role})`);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL_S,
      csrfToken,
    };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────
  // Rotation : invalide l'ancien refresh token, émet un nouveau
  // Validé par le cookie httpOnly + le header X-CSRF-Token (OWASP A05)

  async refresh(user: User & { tokenId: string }, res: Response) {
    await this.prisma.token.update({
      where: { id: user.tokenId },
      data: { usedAt: new Date() },
    });

    const { accessToken, csrfToken } = await this.issueTokens(user, res);
    this.logger.log(`[AUTH] Tokens renouvelés pour userId: ${user.id}`);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL_S,
      csrfToken,
    };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  // Invalide TOUTES les sessions (pas seulement la courante)
  // Protège contre le vol de refresh token sur un autre appareil (OWASP A02)

  async logout(userId: string, res: Response): Promise<void> {
    await this.prisma.token.updateMany({
      where: { userId, type: 'REFRESH', usedAt: null },
      data: { usedAt: new Date() },
    });
    this.clearCookies(res);
    this.logger.log(
      `[AUTH] Déconnexion : userId ${userId} — toutes sessions invalidées`,
    );
  }

  // ─── Forgot password ──────────────────────────────────────────────────────
  // OWASP A07 : réponse identique qu'il existe un compte ou non
  // Un seul token de reset actif à la fois

  async forgotPassword(email: string): Promise<void> {
    const start = Date.now();
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (user?.isActive) {
      // Invalider les anciens tokens de reset
      await this.prisma.token.updateMany({
        where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: new Date() },
      });

      const token = crypto.randomBytes(32).toString('hex');
      await this.prisma.token.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      });

      const resetUrl = `${this.config.get('FRONTEND_URL')}/auth/reset-password?token=${token}`;
      await this.mail.sendPasswordReset({
        to: user.email,
        firstName: user.firstName,
        resetUrl,
      });
      this.logger.log(`[AUTH] Reset password demandé : ${email}`);
    }

    await this.enforceMinDelay(start);
  }

  // ─── Reset password ───────────────────────────────────────────────────────
  // DDIA : transaction atomique (hash + invalidation simultanés)
  // OWASP A02 : invalide toutes les sessions après reset

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.token.findUnique({ where: { token } });

    if (
      !record ||
      record.type !== 'PASSWORD_RESET' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.token.updateMany({
        where: { userId: record.userId, type: 'REFRESH', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    this.logger.log(
      `[AUTH] Mot de passe réinitialisé : userId ${record.userId}`,
    );
  }

  // ─── Confirm account ──────────────────────────────────────────────────────

  async confirmAccount(token: string, password: string): Promise<void> {
    const record = await this.prisma.token.findUnique({ where: { token } });

    if (
      !record ||
      record.type !== 'ACCOUNT_CONFIRMATION' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException("Lien d'invitation invalide ou expiré.");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, isActive: true },
      }),
      this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
    this.logger.log(`[AUTH] Compte confirmé : userId ${record.userId}`);
  }

  // ─── Change password ──────────────────────────────────────────────────────
  // OWASP A02 : invalide toutes les autres sessions après changement

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.token.updateMany({
        where: { userId, type: 'REFRESH', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    this.logger.log(`[AUTH] Mot de passe changé : userId ${userId}`);
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        defaultYardId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            type: true,
            plan: true,
            brandColor: true,
            brandInitials: true,
            brandTagline: true,
            brandLogoText: true,
            site: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException();

    // Modules : si l'user a des modules explicites → les utiliser
    // Sinon → hériter de tous les modules actifs du tenant
    let modules: string[] = [];
    if (user.tenantId) {
      const userModules = await this.prisma.userModule.findMany({
        where: { userId },
        select: { moduleCode: true },
      });
      if (userModules.length > 0) {
        modules = userModules.map((m) => m.moduleCode);
      } else {
        const tenantModules = await this.prisma.tenantModule.findMany({
          where: { tenantId: user.tenantId, isActive: true },
          select: { moduleCode: true },
        });
        modules = tenantModules.map((m) => m.moduleCode);
      }
    }

    let permissions: string[] | null = null;
    let accessRoles: { id: string; code: string; name: string }[] = [];
    let usingLegacyRole = true;
    try {
      const effective = await this.access.effective(userId, user.role);
      permissions = effective.codes;
      accessRoles = effective.roles;
      usingLegacyRole = effective.usingLegacyRole;
    } catch {
      permissions = null;
    }

    return { ...user, modules, permissions, accessRoles, usingLegacyRole };
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  private async issueTokens(
    user: User,
    res: Response,
  ): Promise<{ accessToken: string; csrfToken: string }> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    // Access token — court, retourné dans le body JSON
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TTL_S,
    });

    // Refresh token — long, stocké uniquement en cookie httpOnly
    const refreshToken = this.jwt.sign(
      { sub: user.id },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TTL_S,
      },
    );

    // CSRF token — lié au refresh token (OWASP A05)
    // Stocké dans le body + vérifié côté serveur via header X-CSRF-Token
    const csrfToken = crypto.randomBytes(32).toString('hex');

    // Ne PAS invalider les autres refresh tokens de l'utilisateur ici — un
    // deleteMany global casserait toute session multi-onglets/multi-
    // appareils légitime à chaque refresh (chaque onglet ayant sa propre
    // rotation en mémoire). Chaque refresh token reste indépendant et à
    // usage unique (voir jwt-refresh.strategy.ts) ; seul logout() invalide
    // délibérément TOUTES les sessions (comportement voulu, documenté
    // là-bas). Un nettoyage périodique des tokens expirés/usedAt reste à
    // faire via une tâche planifiée plutôt qu'à chaque émission.

    // upsert sur le champ unique token — idempotent si deux refresh arrivent simultanément
    await this.prisma.token.upsert({
      where: { token: refreshToken },
      create: {
        userId: user.id,
        type: 'REFRESH',
        token: refreshToken,
        expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
      },
      update: {
        expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
        usedAt: null,
      },
    });

    const isProd = this.config.get('NODE_ENV') === 'production';

    // Access token en cookie httpOnly : permet à GET /auth/me de restaurer
    // immédiatement la session après un rafraîchissement, sans exposer le
    // JWT à localStorage (et donc aux scripts injectés/XSS).
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: ACCESS_TTL_S * 1000,
      path: '/api',
    });

    // Refresh token uniquement en cookie httpOnly
    // SameSite=None requis pour le cross-origin Docker (front:3000 → api:3001)
    // Secure=true obligatoire avec SameSite=None (HTTPS en prod, HTTP en dev avec proxy)
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProd, // true en prod (HTTPS), false en dev
      sameSite: isProd ? 'none' : 'lax', // 'none' pour cross-origin prod, 'lax' en dev
      maxAge: REFRESH_TTL_S * 1000,
      path: '/api/auth/refresh', // scopé au seul endpoint qui en a besoin
    });

    // CSRF token en cookie NON httpOnly (lisible par JS, c'est voulu)
    // Le front doit le renvoyer dans X-CSRF-Token à chaque appel /refresh
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false, // lisible par JS intentionnellement
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: REFRESH_TTL_S * 1000,
      path: '/',
    });

    return { accessToken, csrfToken };
  }

  private clearCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/api' });
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    res.clearCookie('csrf_token', { path: '/' });
  }

  // Délai minimum constant (OWASP A02 — anti-timing attack)
  private async enforceMinDelay(startMs: number): Promise<void> {
    const elapsed = Date.now() - startMs;
    if (elapsed < AUTH_DELAY_MS) {
      await new Promise((r) => setTimeout(r, AUTH_DELAY_MS - elapsed));
    }
  }
}
