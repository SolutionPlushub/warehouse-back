import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(MailService.name);

  constructor(private config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.from = this.config.get<string>(
      'RESEND_FROM',
      'noreply@solution-plus.es',
    );
  }

  async sendPasswordReset(opts: {
    to: string;
    firstName: string;
    resetUrl: string;
  }) {
    await this.send({
      to: opts.to,
      subject: 'Réinitialisation de votre mot de passe — Solution+ ILS',
      html: `
        <div style="font-family:Poppins,sans-serif;max-width:520px;margin:auto;padding:32px">
          <div style="background:linear-gradient(135deg,#003D80,#0050A0);padding:24px;border-radius:12px;margin-bottom:24px">
            <p style="color:white;font-size:20px;font-weight:700;margin:0">Solution+ ILS</p>
            <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:4px 0 0">Integrated Logistics Suite</p>
          </div>
          <h2 style="color:#0F172A;font-size:22px">Réinitialisation du mot de passe</h2>
          <p style="color:#334155">Bonjour ${opts.firstName},</p>
          <p style="color:#334155">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous (valable <strong>1 heure</strong>) :</p>
          <a href="${opts.resetUrl}"
             style="display:inline-block;background:#0050A0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Réinitialiser mon mot de passe
          </a>
          <p style="color:#94A3B8;font-size:12px;margin-top:24px">Si vous n'avez pas effectué cette demande, ignorez cet e-mail.<br>Ce lien expire dans 1 heure.</p>
          <hr style="border:none;border-top:1px solid #F1F5F9;margin:24px 0">
          <p style="color:#94A3B8;font-size:11px">© 2026 Solution+ · Suite ILS</p>
        </div>
      `,
    });
  }

  async sendAccountConfirmation(opts: {
    to: string;
    firstName: string;
    confirmUrl: string;
  }) {
    await this.send({
      to: opts.to,
      subject: 'Confirmez votre compte — Solution+ ILS',
      html: `
        <div style="font-family:Poppins,sans-serif;max-width:520px;margin:auto;padding:32px">
          <div style="background:linear-gradient(135deg,#003D80,#0050A0);padding:24px;border-radius:12px;margin-bottom:24px">
            <p style="color:white;font-size:20px;font-weight:700;margin:0">Solution+ ILS</p>
            <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:4px 0 0">Integrated Logistics Suite</p>
          </div>
          <h2 style="color:#0F172A;font-size:22px">Bienvenue, ${opts.firstName} !</h2>
          <p style="color:#334155">Votre compte a été créé. Définissez votre mot de passe pour activer votre accès :</p>
          <a href="${opts.confirmUrl}"
             style="display:inline-block;background:#0050A0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Activer mon compte
          </a>
          <p style="color:#94A3B8;font-size:12px;margin-top:24px">Ce lien expire dans <strong>48 heures</strong>.</p>
          <hr style="border:none;border-top:1px solid #F1F5F9;margin:24px 0">
          <p style="color:#94A3B8;font-size:11px">© 2026 Solution+ · Suite ILS</p>
        </div>
      `,
    });
  }

  async sendTrialEndingSoon(opts: {
    to: string;
    firstName: string;
    daysRemaining: number;
    upgradeUrl: string;
  }) {
    const label =
      opts.daysRemaining <= 0
        ? "se termine aujourd'hui"
        : `se termine dans ${opts.daysRemaining} jour(s)`;
    await this.send({
      to: opts.to,
      subject: `Votre essai gratuit ${label} — Solution+ ILS`,
      html: `
        <div style="font-family:Poppins,sans-serif;max-width:520px;margin:auto;padding:32px">
          <div style="background:linear-gradient(135deg,#003D80,#0050A0);padding:24px;border-radius:12px;margin-bottom:24px">
            <p style="color:white;font-size:20px;font-weight:700;margin:0">Solution+ ILS</p>
            <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:4px 0 0">Integrated Logistics Suite</p>
          </div>
          <h2 style="color:#0F172A;font-size:22px">Bonjour ${opts.firstName},</h2>
          <p style="color:#334155">Votre essai gratuit ${label}. Passez à un plan payant pour continuer à utiliser votre espace sans interruption.</p>
          <a href="${opts.upgradeUrl}"
             style="display:inline-block;background:#0050A0;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Choisir un plan
          </a>
          <hr style="border:none;border-top:1px solid #F1F5F9;margin:24px 0">
          <p style="color:#94A3B8;font-size:11px">© 2026 Solution+ · Suite ILS</p>
        </div>
      `,
    });
  }

  private async send(opts: { to: string; subject: string; html: string }) {
    await this.sendRaw(opts);
  }

  // Envoi générique exposé — utilisé par NotificationsService pour le canal
  // EMAIL des templates de notification (voir notifications/notifications.service.ts).
  // Contrairement à send() ci-dessus (usages internes fixes : reset password,
  // invitation), celle-ci renvoie le succès/échec plutôt que de l'avaler,
  // pour que l'appelant puisse journaliser un statut SENT/FAILED fidèle.
  async sendRaw(opts: {
    to: string | string[];
    cc?: string | string[];
    subject: string;
    html: string;
    attachments?: {
      filename: string;
      content: Buffer;
      contentType?: string;
    }[];
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.resend.emails.send({
        from: this.from,
        to: opts.to,
        ...(opts.cc && opts.cc.length ? { cc: opts.cc } : {}),
        subject: opts.subject,
        html: opts.html,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const toLabel = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
      this.logger.error(`Failed to send email to ${toLabel}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
