import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { UserRole } from '@prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import { resolveEndpointPermission } from '../../access-control/endpoint-access';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const explicit = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest<{
      method?: string;
      user?: { id: string; role: UserRole };
    }>();
    const mapped = explicit
      ? null
      : resolveEndpointPermission(
          context.getClass().name,
          context.getHandler().name,
          req.method ?? 'GET',
        );
    const required = explicit ?? mapped;

    if (required && this.access.isReady()) {
      const user = req.user;
      if (!user?.id) {
        throw new ForbiddenException('Accès refusé : permission insuffisante.');
      }
      try {
        const ok = await this.access.hasAny(user.id, user.role, required);
        if (!ok) {
          throw new ForbiddenException('Accès refusé : permission insuffisante.');
        }
        return true;
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        // Catalogue indisponible : on retombe sur le rôle enum.
      }
    }

    return this.checkRoles(context, req.user?.role);
  }

  private checkRoles(context: ExecutionContext, role?: UserRole): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    if (!required.includes(role as UserRole)) {
      throw new ForbiddenException('Accès refusé : rôle insuffisant.');
    }
    return true;
  }
}
