import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import * as crypto from 'crypto';

// Factorise la logique d'invitation d'un compte (créer un User inactif,
// générer un Token ACCOUNT_CONFIRMATION, envoyer l'email) — auparavant
// dupliquée entre TenantsService.inviteAdmin() (private) et
// UsersService.invite(). Réutilisé aussi par RegistrationService pour
// l'inscription self-service.
@Injectable()
export class AccountInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async inviteUser(params: {
    tenantId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    modules?: string[];
  }) {
    const email = params.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const user = await this.prisma.user.create({
      data: {
        tenantId: params.tenantId,
        email,
        firstName: params.firstName,
        lastName: params.lastName,
        role: params.role as never,
        isActive: false,
        passwordHash: '',
        ...(params.modules?.length
          ? {
              modules: {
                create: params.modules.map((m) => ({ moduleCode: m })),
              },
            }
          : {}),
      },
    });

    await this.sendConfirmationToken(user.id, user.email, user.firstName);

    return user;
  }

  async sendConfirmationToken(
    userId: string,
    email: string,
    firstName: string,
  ) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

    await this.prisma.token.create({
      data: { userId, type: 'ACCOUNT_CONFIRMATION', token, expiresAt },
    });

    const confirmUrl = `${this.config.get('FRONTEND_URL')}/auth/confirm?token=${token}`;
    await this.mail.sendAccountConfirmation({
      to: email,
      firstName,
      confirmUrl,
    });
  }
}
