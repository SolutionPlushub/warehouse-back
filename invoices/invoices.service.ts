import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { DexDecideInvoiceDto } from './dto/dex-decide-invoice.dto';

// Cycle de la facture métier d'un dossier — miroir de
// d.finance.{invoiceStatus,invoiceNo,paid,dexValidation,dexRejection} côté
// frontend (dos-store.js). Distinct de la facturation SaaS de la
// plateforme (billing/).
const VAT_RATE = 0.18; // TVA 18 % — miroir de VAT_RATE (lib/data/data-dos.js)
// Timbre fiscal — entièrement dérivé du moyen de paiement (Payment.method),
// plus un choix manuel : 1 % du sous-total en espèces, aucun timbre sinon.
const STAMP_DUTY_RATE_CASH = 0.01;

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  // Liste globale des factures du tenant (toutes clientèles confondues) —
  // vue Billing (InvoicesScreen/PaymentsScreen côté frontend), distincte de
  // getByFile() qui reste scopée à un dossier. Ne renvoie que les factures
  // réellement émises (DRAFT = brouillon virtuel non persisté, rien à
  // lister pour un dossier qui n'a encore aucune ligne de service).
  async list(
    tenantId: string,
    filters: { status?: string; clientId?: string; includeDrafts?: boolean } = {},
  ) {
    const wantDraftsOnly = filters.status?.toUpperCase() === 'DRAFT';
    const drafts =
      filters.includeDrafts || wantDraftsOnly
        ? await this.listDrafts(tenantId, filters.clientId)
        : [];
    if (wantDraftsOnly) return drafts;
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { not: InvoiceStatus.DRAFT },
        ...(filters.status &&
        ['ISSUED', 'PAID'].includes(filters.status.toUpperCase())
          ? { status: filters.status.toUpperCase() as InvoiceStatus }
          : {}),
        ...(filters.clientId
          ? { shipmentFile: { clientId: filters.clientId } }
          : {}),
      },
      include: {
        shipmentFile: {
          select: {
            id: true,
            voyageCode: true,
            client: { select: { id: true, name: true } },
            payment: { select: { dueDate: true } },
            operations: {
              select: { id: true, type: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    const now = new Date();
    const issued = invoices.map((inv) => {
      const dueDate = inv.shipmentFile.payment?.dueDate ?? null;
      const overdue =
        inv.status === InvoiceStatus.ISSUED &&
        !!dueDate &&
        dueDate < now;
      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        status: inv.status,
        overdue,
        subtotal: inv.subtotal,
        vat: inv.vat,
        stampDuty: inv.stampDuty,
        total: inv.total,
        issuedAt: inv.issuedAt,
        paidAt: inv.paidAt,
        dueDate,
        dexValidatedAt: inv.dexValidatedAt,
        dexRejectedAt: inv.dexRejectedAt,
        shipmentFileId: inv.shipmentFile.id,
        voyageCode: inv.shipmentFile.voyageCode,
        operations: inv.shipmentFile.operations,
        client: inv.shipmentFile.client,
      };
    });
    return [...drafts, ...issued];
  }

  // Factures en préparation : dossiers qui portent des charges mais dont la
  // facture n'est pas encore émise (émission au Gate Out ou depuis l'onglet
  // Finance). Montants recalculés à partir des lignes de service, mêmes
  // règles que computeTotals() (TVA du dossier, timbre 1 % en espèces).
  private async listDrafts(tenantId: string, clientId?: string) {
    const files = await this.prisma.shipmentFile.findMany({
      where: {
        tenantId,
        ...(clientId ? { clientId } : {}),
        serviceLines: { some: {} },
        OR: [{ invoice: null }, { invoice: { status: InvoiceStatus.DRAFT } }],
      },
      select: {
        id: true,
        voyageCode: true,
        vatApplicable: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
        payment: { select: { method: true, dueDate: true } },
        operations: { select: { id: true, type: true }, orderBy: { createdAt: 'asc' } },
        serviceLines: { select: { quantity: true, rate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return files.map((f) => {
      const subtotal = Math.round(
        f.serviceLines.reduce((a, l) => a + l.quantity * l.rate, 0),
      );
      const vat = (f.vatApplicable ?? true) ? Math.round(subtotal * VAT_RATE) : 0;
      const stampDuty =
        f.payment?.method === PaymentMethod.CASH
          ? Math.round(subtotal * STAMP_DUTY_RATE_CASH)
          : 0;
      return {
        id: `draft:${f.id}`,
        invoiceNo: null,
        status: InvoiceStatus.DRAFT,
        overdue: false,
        subtotal,
        vat,
        stampDuty,
        total: subtotal + vat + stampDuty,
        issuedAt: null,
        paidAt: null,
        dueDate: f.payment?.dueDate ?? null,
        dexValidatedAt: null,
        dexRejectedAt: null,
        shipmentFileId: f.id,
        voyageCode: f.voyageCode,
        operations: f.operations,
        client: f.client,
        createdAt: f.createdAt,
      };
    });
  }

  private async assertFile(fileId: string, tenantId: string) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    return file;
  }

  // Facture courante (brouillon virtuel si aucune n'existe encore) —
  // recalculée à partir des ShipmentFileServiceLine actuelles tant que la
  // facture n'a pas été émise.
  async getByFile(fileId: string, tenantId: string, vat?: boolean) {
    await this.assertFile(fileId, tenantId);
    const invoice = await this.prisma.invoice.findUnique({
      where: { shipmentFileId: fileId },
    });
    if (invoice && invoice.status !== InvoiceStatus.DRAFT) return invoice;

    const totals = await this.computeTotals(fileId, tenantId, vat);
    return (
      invoice ?? {
        shipmentFileId: fileId,
        tenantId,
        invoiceNo: null,
        status: InvoiceStatus.DRAFT,
        ...totals,
        issuedAt: null,
        paidAt: null,
        dexValidatedAt: null,
        dexValidatedById: null,
        dexValidationComment: null,
        dexRejectedAt: null,
        dexRejectedById: null,
        dexRejectionComment: null,
      }
    );
  }

  // vatApplicable non fourni (undefined) → repris de ShipmentFile.vatApplicable
  // (choix fait à l'étape Finance de la création, ou modifié depuis l'onglet
  // Finance du détail) ; fourni explicitement → override ponctuel (voir
  // Query('vat') sur InvoicesController, qui laisse passer undefined tel quel
  // pour distinguer "pas précisé" de "false explicite").
  private async computeTotals(
    fileId: string,
    tenantId: string,
    vatApplicable?: boolean,
  ) {
    const file = await this.prisma.shipmentFile.findUnique({
      where: { id: fileId },
      select: {
        vatApplicable: true,
        payment: { select: { method: true } },
      },
    });
    const vatFlag = vatApplicable ?? file?.vatApplicable ?? true;
    const lines = await this.prisma.shipmentFileServiceLine.findMany({
      where: { shipmentFileId: fileId, tenantId },
      select: { quantity: true, rate: true },
    });
    const subtotal = Math.round(
      lines.reduce((a, l) => a + l.quantity * l.rate, 0),
    );
    const vat = vatFlag ? Math.round(subtotal * VAT_RATE) : 0;
    // Timbre fiscal : 1 % du sous-total, uniquement en espèces (pas de
    // choix manuel — voir décision explicite, remplace l'ancien montant
    // fixe de 2000 FCFA toujours actif par défaut côté frontend).
    const stampDuty =
      file?.payment?.method === PaymentMethod.CASH
        ? Math.round(subtotal * STAMP_DUTY_RATE_CASH)
        : 0;
    return { subtotal, vat, stampDuty, total: subtotal + vat + stampDuty };
  }

  // Émission — fige les montants au moment T (les lignes ajoutées ensuite
  // n'affectent plus une facture déjà émise). Miroir de issueInvoice() côté
  // frontend. `vat` non fourni → repris de ShipmentFile.vatApplicable (voir
  // computeTotals ci-dessus).
  async issue(fileId: string, tenantId: string, vat?: boolean) {
    await this.assertFile(fileId, tenantId);
    const existing = await this.prisma.invoice.findUnique({
      where: { shipmentFileId: fileId },
    });
    if (existing && existing.status !== InvoiceStatus.DRAFT)
      throw new BadRequestException('Cette facture a déjà été émise.');

    const totals = await this.computeTotals(fileId, tenantId, vat);
    const year = new Date().getFullYear();
    const seq = (await this.prisma.invoice.count({ where: { tenantId } })) + 1;
    const invoiceNo = `FA-${year}-${String(seq).padStart(4, '0')}`;

    return this.prisma.invoice.upsert({
      where: { shipmentFileId: fileId },
      create: {
        shipmentFileId: fileId,
        tenantId,
        invoiceNo,
        status: InvoiceStatus.ISSUED,
        ...totals,
        issuedAt: new Date(),
      },
      update: {
        invoiceNo,
        status: InvoiceStatus.ISSUED,
        ...totals,
        issuedAt: new Date(),
      },
    });
  }

  // Réémission — recalcule les totaux d'une facture déjà ISSUED (jamais
  // PAID) à partir des ShipmentFileServiceLine ACTUELLES. Nécessaire quand
  // une prestation est ajoutée/modifiée, ou que storageBillingStartedAt
  // (donc storageBillableDays côté séjour) a été corrigé après coup — voir
  // updateGatePass(), OperationsService. Garde le même invoiceNo (c'est la
  // même facture corrigée, pas un nouveau document) ; réinitialise la
  // validation DEX existante puisque les montants ont changé.
  async reissue(fileId: string, tenantId: string, vat?: boolean) {
    await this.assertFile(fileId, tenantId);
    const existing = await this.prisma.invoice.findUnique({
      where: { shipmentFileId: fileId },
    });
    if (!existing || existing.status === InvoiceStatus.DRAFT)
      throw new BadRequestException(
        'Aucune facture émise pour ce dossier — utilisez issue() pour la première émission.',
      );
    if (existing.status === InvoiceStatus.PAID)
      throw new BadRequestException(
        'Cette facture est déjà payée — impossible de la réémettre.',
      );

    const totals = await this.computeTotals(fileId, tenantId, vat);

    return this.prisma.invoice.update({
      where: { id: existing.id },
      data: {
        ...totals,
        issuedAt: new Date(),
        dexValidatedAt: null,
        dexValidatedById: null,
        dexValidationComment: null,
        dexRejectedAt: null,
        dexRejectedById: null,
        dexRejectionComment: null,
      },
    });
  }

  async markPaid(fileId: string, tenantId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { shipmentFileId: fileId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    if (invoice.status === InvoiceStatus.DRAFT)
      throw new BadRequestException(
        'Facture non encore émise — émettez-la avant de la marquer payée.',
      );

    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
  }

  // Validation DEX de la facture (préalable à toute sortie §15) —
  // distincte du flag DEX sur Operation. Miroir de dexValidateInvoice()
  // côté frontend.
  async validateDex(
    fileId: string,
    tenantId: string,
    userId: string,
    dto: DexDecideInvoiceDto,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { shipmentFileId: fileId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    if (invoice.status === InvoiceStatus.DRAFT)
      throw new BadRequestException(
        'Facture non encore émise — la validation DEX intervient après émission.',
      );
    if (invoice.dexValidatedAt)
      throw new BadRequestException('Facture déjà validée par le DEX.');

    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        dexValidatedAt: new Date(),
        dexValidatedById: userId,
        dexValidationComment: dto.comment,
        dexRejectedAt: null,
        dexRejectedById: null,
        dexRejectionComment: null,
      },
    });
  }

  async rejectDex(
    fileId: string,
    tenantId: string,
    userId: string,
    dto: DexDecideInvoiceDto,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { shipmentFileId: fileId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    if (invoice.status === InvoiceStatus.DRAFT)
      throw new BadRequestException(
        'Facture non encore émise — la validation DEX intervient après émission.',
      );

    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        dexValidatedAt: null,
        dexValidatedById: null,
        dexValidationComment: null,
        dexRejectedAt: new Date(),
        dexRejectedById: userId,
        dexRejectionComment: dto.comment,
      },
    });
  }
}
