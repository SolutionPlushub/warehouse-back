import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PermissionEffect, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  legacyPermissionCodes,
  MODULE_LABELS,
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  ROLE_TEMPLATES,
} from './permission-catalog';
import {
  replaceRolePermissions,
  syncAccessCatalog,
  SYSTEM_SCOPE,
} from './sync-access-catalog';

export interface EffectiveAccess {
  codes: string[];
  roles: { id: string; code: string; name: string; isSystem: boolean }[];
  grants: string[];
  denies: string[];
  usingLegacyRole: boolean;
}

interface CacheEntry {
  exp: number;
  access: EffectiveAccess;
}

const CACHE_MS = 30_000;

@Injectable()
export class AccessControlService implements OnModuleInit {
  private readonly logger = new Logger(AccessControlService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private ready = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await syncAccessCatalog(this.prisma);
      this.ready = true;
      this.logger.log(
        `Contrôle d'accès synchronisé (${PERMISSIONS.length} permissions, ${ROLE_TEMPLATES.length} profils système).`,
      );
    } catch (err) {
      this.ready = false;
      this.logger.error(
        `Synchronisation du contrôle d'accès impossible — repli sur les rôles historiques. ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  isReady() {
    return this.ready;
  }

  async hasAny(userId: string, userRole: string, codes: string[]): Promise<boolean> {
    if (!userId) return false;
    if (codes.includes('authenticated')) return true;
    if (userRole === UserRole.SUPER_ADMIN) return true;
    if (!this.ready) return false;
    const access = await this.effective(userId, userRole);
    return codes.some((c) => access.codes.includes(c));
  }

  async effective(userId: string, userRole: string): Promise<EffectiveAccess> {
    const hit = this.cache.get(userId);
    if (hit && hit.exp > Date.now()) return hit.access;

    const access = await this.loadEffective(userId, userRole);
    this.cache.set(userId, { exp: Date.now() + CACHE_MS, access });
    return access;
  }

  async listPermissions() {
    const rows = await this.prisma.permission.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const byModule = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byModule.get(row.module) ?? [];
      list.push(row);
      byModule.set(row.module, list);
    }
    return {
      modules: [...byModule.entries()].map(([code, permissions]) => ({
        code,
        label: MODULE_LABELS[code] ?? code,
        permissions: permissions.map((p) => ({
          id: p.id,
          code: p.code,
          action: p.action,
          label: p.label,
          description: p.description,
          platformOnly: p.platformOnly,
        })),
      })),
    };
  }

  async listRoles(tenantId?: string | null) {
    return this.prisma.accessRole.findMany({
      where: {
        isActive: true,
        OR: [{ scopeKey: SYSTEM_SCOPE }, ...(tenantId ? [{ tenantId }] : [])],
      },
      include: {
        permissions: { include: { permission: { select: { code: true } } } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    }).then((roles) => {
      const overridden = new Set(
        roles.filter((r) => tenantId && r.tenantId === tenantId).map((r) => r.code),
      );
      return roles
        .filter((r) => !(tenantId && r.scopeKey === SYSTEM_SCOPE && overridden.has(r.code)))
        .map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          tenantId: r.tenantId,
          permissions: r.permissions.map((p) => p.permission.code),
        }));
    });
  }

  async createRole(
    caller: { role: string; tenantId: string | null },
    input: { code: string; name: string; description?: string; tenantId?: string | null; permissionCodes?: string[] },
  ) {
    const tenantId = this.resolveTenant(caller, input.tenantId);
    const code = this.normalizeCode(input.code);
    const codes = this.filterAssignable(caller, input.permissionCodes ?? []);
    const scopeKey = tenantId ?? SYSTEM_SCOPE;
    if (!tenantId && caller.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Seul un super administrateur crée un profil système.');
    }

    const existing = await this.prisma.accessRole.findUnique({
      where: { scopeKey_code: { scopeKey, code } },
    });
    if (existing) throw new BadRequestException('Ce code de profil existe déjà.');

    const role = await this.prisma.accessRole.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        scopeKey,
        tenantId,
        isSystem: scopeKey === SYSTEM_SCOPE,
        defaultsApplied: true,
      },
    });
    await replaceRolePermissions(this.prisma, role.id, codes);
    this.invalidate();
    return this.getRole(role.id);
  }

  async updateRole(
    caller: { role: string; tenantId: string | null },
    roleId: string,
    input: { name?: string; description?: string; isActive?: boolean },
  ) {
    const role = await this.mustRole(roleId);
    this.assertCanEdit(caller, role);
    const updated = await this.prisma.accessRole.update({
      where: { id: roleId },
      data: {
        ...(input.name != null ? { name: input.name.trim() } : {}),
        ...(input.description != null ? { description: input.description.trim() } : {}),
        ...(input.isActive != null ? { isActive: input.isActive } : {}),
      },
    });
    this.invalidate();
    return updated;
  }

  async setRolePermissions(
    caller: { role: string; tenantId: string | null },
    roleId: string,
    permissionCodes: string[],
  ) {
    const role = await this.mustRole(roleId);
    const codes = this.filterAssignable(caller, permissionCodes);
    if (role.scopeKey === SYSTEM_SCOPE && caller.role !== UserRole.SUPER_ADMIN) {
      if (!caller.tenantId) {
        throw new ForbiddenException('Organisation introuvable.');
      }
      const savedId = await this.writeOrganizationMatrix(caller.tenantId, role, codes);
      this.invalidate();
      return this.getRole(savedId);
    }
    this.assertCanEdit(caller, role);
    await replaceRolePermissions(this.prisma, roleId, codes);
    if (!role.defaultsApplied) {
      await this.prisma.accessRole.update({
        where: { id: roleId },
        data: { defaultsApplied: true },
      });
    }
    this.invalidate();
    return this.getRole(roleId);
  }

  async resetRoleDefaults(caller: { role: string }, roleId: string) {
    if (caller.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Réservé au super administrateur.');
    }
    const role = await this.mustRole(roleId);
    const tpl = ROLE_TEMPLATES.find((t) => t.code === role.code);
    if (!tpl || role.scopeKey !== SYSTEM_SCOPE) {
      throw new BadRequestException('Ce profil n\'a pas de modèle système.');
    }
    await replaceRolePermissions(this.prisma, roleId, tpl.permissions);
    await this.prisma.accessRole.update({
      where: { id: roleId },
      data: { defaultsApplied: true, name: tpl.name, description: tpl.description },
    });
    this.invalidate();
    return this.getRole(roleId);
  }

  async duplicateRole(
    caller: { role: string; tenantId: string | null },
    roleId: string,
    tenantId?: string | null,
  ) {
    const source = await this.getRole(roleId);
    const targetTenant = this.resolveTenant(caller, tenantId ?? caller.tenantId);
    if (!targetTenant) throw new BadRequestException('Organisation cible requise.');
    const code = source.code;
    const existing = await this.prisma.accessRole.findUnique({
      where: { scopeKey_code: { scopeKey: targetTenant, code } },
    });
    if (existing) return this.getRole(existing.id);
    return this.createRole(
      { role: UserRole.SUPER_ADMIN, tenantId: targetTenant },
      {
        code,
        name: source.name,
        description: source.description,
        tenantId: targetTenant,
        permissionCodes: this.filterAssignable(caller, source.permissions),
      },
    );
  }

  async deleteRole(caller: { role: string; tenantId: string | null }, roleId: string) {
    const role = await this.mustRole(roleId);
    if (role.isSystem && role.scopeKey === SYSTEM_SCOPE) {
      throw new BadRequestException('Un profil système ne peut pas être supprimé.');
    }
    this.assertCanEdit(caller, role);
    await this.prisma.accessRole.delete({ where: { id: roleId } });
    this.invalidate();
    return { id: roleId };
  }

  async getUserAccess(caller: { id: string; role: string; tenantId: string | null }, userId: string) {
    await this.assertUserVisible(caller, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return this.effective(user.id, user.role);
  }

  async setUserAccess(
    caller: { id: string; role: string; tenantId: string | null },
    userId: string,
    input: { roleIds: string[]; grants?: string[]; denies?: string[] },
  ) {
    await this.assertUserVisible(caller, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, role: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const roleIds = [...new Set(input.roleIds)];
    if (roleIds.length) {
      const roles = await this.prisma.accessRole.findMany({
        where: { id: { in: roleIds }, isActive: true },
      });
      if (roles.length !== roleIds.length) {
        throw new BadRequestException('Un ou plusieurs profils sont introuvables.');
      }
      for (const role of roles) {
        const visible =
          role.scopeKey === SYSTEM_SCOPE || role.tenantId === user.tenantId;
        if (!visible) throw new ForbiddenException('Profil hors de l\'organisation.');
      }
    }

    const grants = this.filterAssignable(caller, input.grants ?? []);
    const denies = this.filterAssignable(caller, input.denies ?? []);
    const overlap = grants.filter((c) => denies.includes(c));
    if (overlap.length) {
      throw new BadRequestException(`Permission à la fois accordée et retirée : ${overlap.join(', ')}`);
    }

    const permRows = await this.prisma.permission.findMany({
      where: { code: { in: [...grants, ...denies] }, isActive: true },
      select: { id: true, code: true },
    });
    const idByCode = new Map(permRows.map((p) => [p.code, p.id]));
    for (const code of [...grants, ...denies]) {
      if (!idByCode.has(code)) throw new BadRequestException(`Permission inconnue : ${code}`);
    }

    await this.prisma.$transaction([
      this.prisma.userAccessRole.deleteMany({ where: { userId } }),
      ...(roleIds.length
        ? [
            this.prisma.userAccessRole.createMany({
              data: roleIds.map((roleId) => ({ userId, roleId })),
            }),
          ]
        : []),
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      ...[...grants, ...denies].flatMap((code) => {
        const permissionId = idByCode.get(code);
        if (!permissionId) return [];
        return [
          this.prisma.userPermission.create({
            data: {
              userId,
              permissionId,
              effect: grants.includes(code) ? PermissionEffect.GRANT : PermissionEffect.DENY,
            },
          }),
        ];
      }),
    ]);

    this.invalidate(userId);
    return this.effective(userId, user.role);
  }

  private async loadEffective(userId: string, userRole: string): Promise<EffectiveAccess> {
    const [assignments, overrides, allPerms] = await Promise.all([
      this.prisma.userAccessRole.findMany({
        where: { userId, role: { isActive: true } },
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      }),
      this.prisma.userPermission.findMany({
        where: { userId },
        include: { permission: true },
      }),
      this.prisma.permission.findMany({
        where: { isActive: true },
        select: { code: true },
      }),
    ]);

    const allCodes = allPerms.map((p) => p.code);
    const usingLegacyRole = assignments.length === 0 && userRole !== UserRole.SUPER_ADMIN;
    const codes = new Set<string>(
      userRole === UserRole.SUPER_ADMIN
        ? allCodes
        : usingLegacyRole
          ? legacyPermissionCodes(userRole, allCodes)
          : [],
    );

    if (!usingLegacyRole && userRole !== UserRole.SUPER_ADMIN) {
      for (const link of assignments) {
        for (const rp of link.role.permissions) {
          if (rp.permission.isActive) codes.add(rp.permission.code);
        }
      }
    }

    const grants: string[] = [];
    const denies: string[] = [];
    if (userRole !== UserRole.SUPER_ADMIN) {
      for (const ov of overrides) {
        if (!ov.permission.isActive) continue;
        if (ov.effect === PermissionEffect.GRANT) {
          codes.add(ov.permission.code);
          grants.push(ov.permission.code);
        } else {
          codes.delete(ov.permission.code);
          denies.push(ov.permission.code);
        }
      }
    }

    return {
      codes: [...codes].sort(),
      roles: assignments.map((a) => ({
        id: a.role.id,
        code: a.role.code,
        name: a.role.name,
        isSystem: a.role.isSystem,
      })),
      grants,
      denies,
      usingLegacyRole: userRole === UserRole.SUPER_ADMIN ? false : usingLegacyRole,
    };
  }

  private async getRole(roleId: string) {
    const role = await this.prisma.accessRole.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    });
    if (!role) throw new NotFoundException('Profil introuvable.');
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      tenantId: role.tenantId,
      permissions: role.permissions.map((p) => p.permission.code),
    };
  }

  private async mustRole(roleId: string) {
    const role = await this.prisma.accessRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Profil introuvable.');
    return role;
  }

  /** La matrice d'un profil commun est copiée dans l'organisation, sans modifier les autres. */
  private async writeOrganizationMatrix(
    tenantId: string,
    source: { id: string; code: string; name: string; description: string },
    codes: string[],
  ) {
    const existing = await this.prisma.accessRole.findUnique({
      where: { scopeKey_code: { scopeKey: tenantId, code: source.code } },
    });
    const target = existing ?? await this.prisma.accessRole.create({
      data: {
        code: source.code,
        name: source.name,
        description: source.description,
        scopeKey: tenantId,
        tenantId,
        isSystem: false,
        defaultsApplied: true,
      },
    });
    await replaceRolePermissions(this.prisma, target.id, codes);
    const holders = await this.prisma.userAccessRole.findMany({
      where: { roleId: source.id, user: { tenantId } },
      select: { userId: true },
    });
    if (holders.length) {
      const userIds = holders.map((link) => link.userId);
      await this.prisma.$transaction([
        ...userIds.map((userId) =>
          this.prisma.userAccessRole.upsert({
            where: { userId_roleId: { userId, roleId: target.id } },
            create: { userId, roleId: target.id },
            update: {},
          }),
        ),
        this.prisma.userAccessRole.deleteMany({
          where: { roleId: source.id, userId: { in: userIds } },
        }),
      ]);
    }
    return target.id;
  }

  private assertCanEdit(
    caller: { role: string; tenantId: string | null },
    role: { scopeKey: string; tenantId: string | null; isSystem: boolean },
  ) {
    if (caller.role === UserRole.SUPER_ADMIN) return;
    if (role.scopeKey === SYSTEM_SCOPE) {
      throw new ForbiddenException(
        'Profil système en lecture seule. Dupliquez-le dans votre organisation pour le personnaliser.',
      );
    }
    if (role.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Profil hors de votre organisation.');
    }
  }

  private resolveTenant(
    caller: { role: string; tenantId: string | null },
    requested?: string | null,
  ): string | null {
    if (caller.role === UserRole.SUPER_ADMIN) return requested ?? null;
    return caller.tenantId;
  }

  private filterAssignable(caller: { role: string }, codes: string[]): string[] {
    const known = new Set(PERMISSIONS.map((p) => p.code));
    const unique = [...new Set(codes)].filter((c) => known.has(c));
    if (caller.role === UserRole.SUPER_ADMIN) return unique;
    return unique.filter((c) => !PLATFORM_PERMISSIONS.includes(c));
  }

  private normalizeCode(code: string): string {
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!normalized) throw new BadRequestException('Code de profil invalide.');
    return normalized;
  }

  private async assertUserVisible(
    caller: { id: string; role: string; tenantId: string | null },
    userId: string,
  ) {
    if (caller.role === UserRole.SUPER_ADMIN || caller.id === userId) return;
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (!target || target.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Utilisateur hors de votre organisation.');
    }
  }
}
