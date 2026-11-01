import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotifChannel, NotifStatus } from '@prisma/client';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
} from './dto/upsert-template.dto';
import { SendNotificationDto } from './dto/send-notification.dto';

// Persistance des templates de notification et de leur historique d'envoi.
// Canal EMAIL : réellement livré via MailService (Resend), déjà branché et
// utilisé pour les emails d'auth (reset password, invitations) — voir
// mail/mail.service.ts. Canaux SMS/PUSH : AUCUN fournisseur n'est branché
// (pas de Twilio pour SMS, pas d'infra push) — send() journalise ces
// canaux avec un statut simulé (SENT) sans livraison réelle. Le point
// d'intégration pour SMS resterait cette même méthode.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // ── Templates ────────────────────────────────────────────────────────────

  async listTemplates(tenantId: string) {
    const templates = await this.prisma.notificationTemplate.findMany({
      where: { tenantId },
      include: {
        _count: { select: { logs: true } },
        logs: {
          where: { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return templates.map((t) => ({
      ...t,
      sentTotal: t._count.logs,
      sent30d: t.logs.length,
      logs: undefined,
      _count: undefined,
    }));
  }

  async createTemplate(tenantId: string, dto: CreateTemplateDto) {
    return this.prisma.notificationTemplate.create({
      data: { tenantId, ...dto },
    });
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateTemplateDto) {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Template introuvable.');
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async deleteTemplate(tenantId: string, id: string) {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Template introuvable.');
    return this.prisma.notificationTemplate.delete({ where: { id } });
  }

  // ── Envoi — EMAIL réellement livré (MailService/Resend), SMS/PUSH simulés
  //    (voir note en tête de fichier) ────────────────────────────────────

  async send(
    tenantId: string,
    templateId: string,
    userId: string,
    dto: SendNotificationDto,
  ) {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) throw new NotFoundException('Template introuvable.');

    // Un log par canal déclaré sur le template (ex: SMS+Email → 2 lignes).
    // EMAIL est livré avant journalisation pour connaître le statut réel ;
    // SMS/PUSH restent simulés faute de fournisseur branché.
    const logs = await Promise.all(
      template.channels.map(async (channel) => {
        let status: NotifStatus = NotifStatus.SENT;
        let errorMsg: string | undefined;
        if (channel === NotifChannel.EMAIL) {
          const result = await this.mailService.sendRaw({
            to: dto.to,
            subject: dto.subject || template.name,
            html: `<div style="font-family:Poppins,sans-serif;white-space:pre-wrap">${template.body}</div>`,
          });
          status = result.ok ? NotifStatus.SENT : NotifStatus.FAILED;
          errorMsg = result.error;
        }
        return this.prisma.notificationLog.create({
          data: {
            tenantId,
            templateId,
            channel,
            to: dto.to,
            subject: dto.subject,
            status,
            errorMsg,
            sentById: userId,
          },
        });
      }),
    );
    return logs;
  }

  // ── Historique ───────────────────────────────────────────────────────────

  async listLogs(
    tenantId: string,
    filters: { channel?: string; status?: string } = {},
    take = 100,
  ) {
    const channel = filters.channel?.toUpperCase();
    const status = filters.status?.toUpperCase();
    const validChannel =
      channel && channel in NotifChannel
        ? (channel as NotifChannel)
        : undefined;
    const validStatus =
      status && status in NotifStatus ? (status as NotifStatus) : undefined;

    return this.prisma.notificationLog.findMany({
      where: {
        tenantId,
        ...(validChannel ? { channel: validChannel } : {}),
        ...(validStatus ? { status: validStatus } : {}),
      },
      include: { template: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
