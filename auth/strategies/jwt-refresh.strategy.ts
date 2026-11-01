import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

const refreshCookieExtractor = (req: Request): string | null => {
  return (
    (req?.cookies as Record<string, string> | undefined)?.['refresh_token'] ??
    null
  );
};

// Fenêtre de grâce après rotation d'un refresh token — absorbe la course
// entre requêtes /auth/refresh quasi-simultanées (ex: timer de refresh
// proactif + rechargement de page, ou plusieurs onglets) : le navigateur
// n'a qu'un seul cookie refresh_token à la fois, donc une requête un peu en
// retard peut encore présenter le token que la requête gagnante vient de
// faire tourner. Plutôt que la rejeter (déconnexion alors que la session
// est valide), on la fait passer sur le nouveau token déjà émis pour ce
// même utilisateur. Passé ce délai, un token usedAt reste rejeté (usage
// unique réel, protection contre le vol/replay).
const REUSE_GRACE_MS = 10_000;

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([refreshCookieExtractor]),
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true as const,
    });
  }

  async validate(req: Request, _payload: { sub: string }): Promise<object> {
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[
      'refresh_token'
    ];
    if (!rawToken) throw new UnauthorizedException('Refresh token manquant.');

    const token = await this.prisma.token.findUnique({
      where: { token: rawToken },
      include: { user: true },
    });

    if (!token || token.type !== 'REFRESH' || token.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalide ou expiré.');
    }

    let effective = token;
    if (token.usedAt) {
      // Token déjà tourné — dans la fenêtre de grâce, redirige vers le
      // nouveau token émis pour cet utilisateur (course entre requêtes
      // concurrentes, voir REUSE_GRACE_MS ci-dessus) au lieu de rejeter.
      if (Date.now() - token.usedAt.getTime() > REUSE_GRACE_MS) {
        throw new UnauthorizedException('Refresh token invalide ou expiré.');
      }
      const replacement = await this.prisma.token.findFirst({
        where: {
          userId: token.userId,
          type: 'REFRESH',
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!replacement)
        throw new UnauthorizedException('Refresh token invalide ou expiré.');
      effective = { ...replacement, user: token.user };
    }

    const dbUser: { isActive: boolean } = effective.user;
    if (!dbUser.isActive) throw new UnauthorizedException('Compte désactivé.');

    return {
      ...effective.user,
      rawRefreshToken: effective.token,
      tokenId: effective.id,
    };
  }
}
