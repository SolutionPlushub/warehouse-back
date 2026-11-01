import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountInvitationService } from '../common/account-invitation/account-invitation.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';

// Domaines email jetables courants — liste courte volontairement (voir §0.6
// du plan : pas de blocage sur "domaine pro", juste les jetables connus).
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'yopmail.com',
  'tempmail.com',
  'guerrillamail.com',
  '10minutemail.com',
  'trashmail.com',
]);

const DEFAULT_CURRENCY = 'XOF';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountInvitation: AccountInvitationService,
  ) {}

  async register(dto: RegisterTenantDto) {
    const email = dto.adminEmail.toLowerCase().trim();
    const domain = email.split('@')[1];
    if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      throw new ConflictException(
        "Merci d'utiliser une adresse e-mail valide (les adresses jetables ne sont pas acceptées).",
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Cet e-mail est déjà utilisé.');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { code: 'STARTER' },
    });
    if (!plan) {
      throw new NotFoundException(
        "Le plan Starter n'est pas configuré — contactez le support.",
      );
    }
    const planPrice = await this.prisma.planPrice.findUnique({
      where: {
        planId_interval_currency: {
          planId: plan.id,
          interval: 'MONTHLY',
          currency: DEFAULT_CURRENCY,
        },
      },
    });
    if (!planPrice) {
      throw new NotFoundException(
        'Tarification du plan Starter introuvable — contactez le support.',
      );
    }

    const slug = await this.generateUniqueSlug(dto.slug ?? dto.companyName);

    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000,
    );

    const { tenantId, userId, userEmail, userFirstName } =
      await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            type: 'OPERATOR',
            name: dto.companyName,
            slug,
            plan: plan.name,
            brandInitials: slug.slice(0, 3).toUpperCase(),
          },
        });

        // Le module Admin est toujours inclus — c'est l'outil de gestion du
        // compte lui-même, pas une fonctionnalité vendue séparément.
        await tx.tenantModule.create({
          data: { tenantId: tenant.id, moduleCode: 'Admin', isActive: true },
        });
        await tx.tenantModule.create({
          data: {
            tenantId: tenant.id,
            moduleCode: dto.selectedModuleCode,
            isActive: true,
          },
        });

        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            planPriceId: planPrice.id,
            status: 'TRIALING',
            trialEndsAt,
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt,
          },
        });

        const email2 = email;
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: email2,
            firstName: dto.adminFirstName,
            lastName: dto.adminLastName,
            role: 'ADMIN',
            isActive: false,
            passwordHash: '',
          },
        });

        return {
          tenantId: tenant.id,
          userId: user.id,
          userEmail: user.email,
          userFirstName: user.firstName,
        };
      });

    // Hors transaction : envoi de l'email (I/O externe, pas de rollback DB
    // souhaité si Resend est temporairement indisponible — le compte reste
    // créé, l'admin peut redemander un lien via "mot de passe oublié").
    await this.accountInvitation.sendConfirmationToken(
      userId,
      userEmail,
      userFirstName,
    );

    return {
      tenantId,
      message:
        'Compte créé. Vérifiez votre boîte mail pour activer votre compte.',
    };
  }

  private async generateUniqueSlug(source: string): Promise<string> {
    const base =
      source
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'org';

    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.tenant.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
}
