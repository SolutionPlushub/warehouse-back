import { PrismaClient } from '@prisma/client';
import {
  assertCatalog,
  PERMISSIONS,
  ROLE_TEMPLATES,
} from './permission-catalog';

export const SYSTEM_SCOPE = 'SYSTEM';

/**
 * Upsert du catalogue et des profils système.
 * Les matrices déjà personnalisées (defaultsApplied) ne sont pas réécrites.
 */
export async function syncAccessCatalog(prisma: PrismaClient): Promise<void> {
  assertCatalog();
  const codes = PERMISSIONS.map((p) => p.code);

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        module: p.module,
        action: p.action,
        label: p.label,
        description: p.description ?? '',
        platformOnly: p.platformOnly ?? false,
        sortOrder: p.sortOrder,
        isActive: true,
      },
      update: {
        module: p.module,
        action: p.action,
        label: p.label,
        description: p.description ?? '',
        platformOnly: p.platformOnly ?? false,
        sortOrder: p.sortOrder,
        isActive: true,
      },
    });
  }

  await prisma.permission.updateMany({
    where: { code: { notIn: codes } },
    data: { isActive: false },
  });

  for (const role of ROLE_TEMPLATES) {
    const existing = await prisma.accessRole.findUnique({
      where: { scopeKey_code: { scopeKey: SYSTEM_SCOPE, code: role.code } },
    });

    if (!existing) {
      const created = await prisma.accessRole.create({
        data: {
          code: role.code,
          name: role.name,
          description: role.description,
          scopeKey: SYSTEM_SCOPE,
          isSystem: true,
          defaultsApplied: true,
          isActive: true,
        },
      });
      await replaceRolePermissions(prisma, created.id, role.permissions);
      continue;
    }

    await prisma.accessRole.update({
      where: { id: existing.id },
      data: {
        name: role.name,
        description: role.description,
        isSystem: true,
        isActive: true,
      },
    });

    if (!existing.defaultsApplied) {
      await replaceRolePermissions(prisma, existing.id, role.permissions);
      await prisma.accessRole.update({
        where: { id: existing.id },
        data: { defaultsApplied: true },
      });
    }
  }

  await grantMissingSystemPermissions(prisma, 'ADMIN', [
    'clients.read',
    'clients.manage',
    'clients.commercial.read',
    'reporting.read',
    'reporting.schedule',
    'reporting.ai',
  ]);
}

/** Ajoute des droits aux profils de ce code (modèle commun et copies d'organisation)
 *  sans écraser le reste de la matrice. */
async function grantMissingSystemPermissions(
  prisma: PrismaClient,
  roleCode: string,
  codes: string[],
): Promise<void> {
  const roles = await prisma.accessRole.findMany({
    where: { code: roleCode, isActive: true },
    select: { id: true },
  });
  const perms = await prisma.permission.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true },
  });
  if (!roles.length || !perms.length) return;
  await prisma.rolePermission.createMany({
    data: roles.flatMap((role) =>
      perms.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
    ),
    skipDuplicates: true,
  });
}

export async function replaceRolePermissions(
  prisma: PrismaClient,
  roleId: string,
  codes: string[],
): Promise<void> {
  const perms = await prisma.permission.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (perms.length === 0) return;
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId, permissionId: p.id })),
  });
}
