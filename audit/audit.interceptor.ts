import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, concatMap, from, map, Observable, of } from 'rxjs';
import { AuditService } from './audit.service';
import { classifyMutation } from './audit.labels';

const AUDITABLE_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

type AuthedUser = {
  id?: string;
  tenantId?: string | null;
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      user?: AuthedUser;
    }>();
    const method = (req.method || '').toUpperCase();
    if (!AUDITABLE_METHODS.has(method)) return next.handle();

    const path = req.originalUrl || req.url || '';
    const params = req.params || {};
    const classified = classifyMutation(method, path, params, req.body);
    if (!classified) return next.handle();

    const user = req.user;
    if (!user?.id) return next.handle();

    return next.handle().pipe(
      concatMap((response: unknown) =>
        from(
          this.persist({
            method,
            path,
            params,
            body: req.body,
            user,
            tenantId: user.tenantId || null,
            classified,
            response,
          }),
        ).pipe(
          map((): unknown => response),
          catchError(() => of(response)),
        ),
      ),
    );
  }

  private async persist(args: {
    method: string;
    path: string;
    params: Record<string, string>;
    body?: Record<string, unknown>;
    user?: AuthedUser;
    tenantId: string | null;
    classified: ReturnType<typeof classifyMutation>;
    response: unknown;
  }) {
    if (!args.classified) return;
    const fileId = await this.resolveFileId(
      args.params,
      args.path,
      args.response,
      args.tenantId,
    );
    if (!fileId) return;
    const tenantId = args.tenantId || (await this.audit.tenantIdOfFile(fileId));
    if (!tenantId) return;
    await this.audit.log({
      tenantId,
      shipmentFileId: fileId,
      userId: args.user?.id,
      action: args.classified.action,
      label: args.classified.label,
      method: args.method,
      path: args.path,
      field:
        args.classified.action === 'DOCUMENT_DELETE'
          ? (args.response as { name?: string } | null)?.name ||
            args.classified.field
          : args.classified.field,
      from: args.classified.from,
      to: args.classified.to,
      payload: args.body,
    });
  }

  private async resolveFileId(
    params: Record<string, string>,
    path: string,
    response: unknown,
    tenantId: string | null,
  ) {
    if (params.fileId) return params.fileId;
    if (params.operationId)
      return this.audit.resolveFileIdFromOperation(params.operationId, tenantId);
    if (params.id && path.includes('/wms/shipments/')) return params.id;
    const created = (response as { id?: string } | null)?.id;
    if (created && /\/wms\/shipments\/?(\?|$)/.test(path.split('?')[0]))
      return created;
    if (params.receiptId)
      return this.audit.resolveFileIdFromReceipt(params.receiptId, tenantId);
    if (params.lineId && path.includes('/wms/lines/'))
      return this.audit.resolveFileIdFromShipmentLine(params.lineId, tenantId);
    if (params.movId)
      return this.audit.resolveFileIdFromExitMovement(params.movId, tenantId);
    if (params.id && path.includes('/payments/'))
      return this.audit.resolveFileIdFromPayment(params.id, tenantId);
    return created ?? null;
  }
}
