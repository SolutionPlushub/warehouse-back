import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { AccountInvitationService } from '../common/account-invitation/account-invitation.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  tenantId: true,
  defaultYardId: true,
  tenant: { select: { id: true, name: true, slug: true, brandColor: true } },
  modules: { select: { moduleCode: true } },
  accessRoles: {
    select: { role: { select: { id: true, code: true, name: true } } },
  },
} as const;

type UserWithModules = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  tenantId: string | null;
  defaultYardId: string | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    brandColor: string | null;
  } | null;
  modules: { moduleCode: string }[];
  accessRoles: { role: { id: string; code: string; name: string } }[];
};

type FlatUser = Omit<UserWithModules, 'modules' | 'accessRoles'> & {
  modules: string[];
  profiles: { id: string; code: string; name: string }[];
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private config: ConfigService,
    private accountInvitation: AccountInvitationService,
    private planLimits: PlanLimitsService,
  ) {}

  async findAllByTenant(tenantId: string): Promise<FlatUser[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.flattenModules(u));
  }

  async findOne(id: string): Promise<FlatUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return this.flattenModules(user);
  }

  async invite(dto: CreateUserDto): Promise<FlatUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) throw new ConflictException('Cet e-mail est déjà utilisé.');

    if (dto.tenantId) {
      await this.planLimits.assertCanAddUser(dto.tenantId);
    }

    const created = await this.accountInvitation.inviteUser({
      tenantId: dto.tenantId ?? null,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      modules: dto.modules,
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      select: USER_SELECT,
    });

    return this.flattenModules(user);
  }

  async toggle(id: string): Promise<FlatUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: USER_SELECT,
    });
    return this.flattenModules(updated);
  }

  async update(
    id: string,
    data: { firstName?: string; lastName?: string; role?: string },
  ): Promise<FlatUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const { role, ...rest } = data;
    const updated = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(role ? { role: role as UserRole } : {}) },
      select: USER_SELECT,
    });

    return this.flattenModules(updated);
  }

  async setModules(userId: string, modules: string[]): Promise<FlatUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    await this.prisma.$transaction([
      this.prisma.userModule.deleteMany({ where: { userId } }),
      ...modules.map((m) =>
        this.prisma.userModule.create({ data: { userId, moduleCode: m } }),
      ),
    ]);

    const updated = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!updated) throw new NotFoundException('Utilisateur introuvable.');
    return this.flattenModules(updated);
  }

  async sendPasswordReset(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (!user.isActive) throw new BadRequestException('Compte inactif.');

    await this.prisma.token.updateMany({
      where: { userId: id, type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.token.create({
      data: {
        userId: id,
        type: 'PASSWORD_RESET',
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const resetUrl = `${this.config.get('FRONTEND_URL')}/auth/reset-password?token=${token}`;
    await this.mail.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
    });
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8)
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères.',
      );
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, isActive: true },
      }),
      this.prisma.token.updateMany({
        where: { userId: id, type: 'REFRESH', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async remove(id: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    await this.prisma.$transaction([
      this.prisma.userModule.deleteMany({ where: { userId: id } }),
      this.prisma.token.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
    return { id };
  }

  async setDefaultYard(
    userId: string,
    tenantId: string | null,
    yardId: string | null,
  ): Promise<FlatUser> {
    if (yardId) {
      const yard = await this.prisma.yard.findFirst({
        where: { id: yardId, tenantId: tenantId ?? undefined },
      });
      if (!yard) throw new NotFoundException('Yard introuvable.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { defaultYardId: yardId },
      select: USER_SELECT,
    });
    return this.flattenModules(updated);
  }

  private flattenModules(user: UserWithModules): FlatUser {
    const { modules, accessRoles, ...rest } = user;
    return {
      ...rest,
      modules: modules.map((m) => m.moduleCode),
      profiles: (accessRoles ?? []).map((a) => a.role),
    };
  }
}
