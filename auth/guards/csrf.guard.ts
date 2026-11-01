import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

// OWASP A05 — CSRF protection sur le refresh endpoint
// Le cookie csrf_token (lisible JS) doit correspondre au header X-CSRF-Token
// Un attaquant peut envoyer le cookie (CSRF) mais pas lire le cookie pour le recopier dans le header
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const cookieToken = req.cookies?.['csrf_token'] as string | undefined;
    const headerToken = req.headers['x-csrf-token'] as string | undefined;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Token CSRF invalide.');
    }
    return true;
  }
}
