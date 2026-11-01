import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEntry = {
  tenantId: string;
  shipmentFileId: string;
  userId?: string | null;
  action: string;
  label: string;
  method: string;
  path: string;
  field?: string | null;
  from?: string | null;
  to?: string | null;
  payload?: unknown;
};

const SENSITIVE = /password|token|secret|hash|authorization|cookie/i;
const MAX_PAYLOAD = 8_000;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    try {
      await this.prisma.shipmentFileAuditLog.create({
        data: {
          tenantId: entry.tenantId,
          shipmentFileId: entry.shipmentFileId,
          userId: entry.userId || null,
          action: entry.action,
          label: entry.label,
          method: entry.method,
          path: entry.path.slice(0, 512),
          field: entry.field || null,
          from: clip(entry.from),
          to: clip(entry.to),
          payload: sanitize(entry.payload) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit log skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listByFile(shipmentFileId: string, tenantId: string, take = 300) {
    return this.prisma.shipmentFileAuditLog.findMany({
      where: { shipmentFileId, tenantId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async resolveFileIdFromReceipt(receiptId: string, tenantId?: string | null) {
    const row = await this.prisma.shipmentReceipt.findFirst({
      where: {
        id: receiptId,
        ...(tenantId ? { shipmentFile: { tenantId } } : {}),
      },
      select: { shipmentFileId: true },
    });
    return row?.shipmentFileId ?? null;
  }

  async resolveFileIdFromShipmentLine(lineId: string, tenantId?: string | null) {
    const row = await this.prisma.shipmentLine.findFirst({
      where: { id: lineId, ...(tenantId ? { tenantId } : {}) },
      select: { shipmentFileId: true },
    });
    return row?.shipmentFileId ?? null;
  }

  async resolveFileIdFromExitMovement(movId: string, tenantId?: string | null) {
    const row = await this.prisma.exitMovement.findFirst({
      where: { id: movId, ...(tenantId ? { tenantId } : {}) },
      select: { shipmentFileId: true },
    });
    return row?.shipmentFileId ?? null;
  }

  async tenantIdOfFile(fileId: string) {
    const row = await this.prisma.shipmentFile.findUnique({
      where: { id: fileId },
      select: { tenantId: true },
    });
    return row?.tenantId ?? null;
  }

  async resolveFileIdFromOperation(
    operationId: string,
    tenantId?: string | null,
  ) {
    const row = await this.prisma.operation.findFirst({
      where: { id: operationId, ...(tenantId ? { tenantId } : {}) },
      select: { shipmentFileId: true },
    });
    return row?.shipmentFileId ?? null;
  }

  async resolveFileIdFromPayment(paymentId: string, tenantId?: string | null) {
    const row = await this.prisma.payment.findFirst({
      where: { id: paymentId, ...(tenantId ? { tenantId } : {}) },
      select: { shipmentFile: { select: { id: true } } },
    });
    return row?.shipmentFile?.id ?? null;
  }
}

function clip(value?: string | null) {
  if (value == null || value === '') return null;
  return value.length > 240 ? `${value.slice(0, 237)}…` : value;
}

function sanitize(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  try {
    const cleaned = scrub(value);
    const json = JSON.stringify(cleaned);
    if (!json || json === '{}' || json === '[]') return Prisma.JsonNull;
    if (json.length > MAX_PAYLOAD)
      return { truncated: true, preview: json.slice(0, MAX_PAYLOAD) };
    return cleaned as Prisma.InputJsonValue;
  } catch {
    return Prisma.JsonNull;
  }
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 40).map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.test(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}
