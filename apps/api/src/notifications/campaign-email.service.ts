import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailNotificationType } from '../common/prisma-types';

/**
 * CampaignEmailService — template + pengiriman email notifikasi campaign via Resend.
 *
 * Desain mengikuti mockup user "rev 3" (mockup-email-notifications.html):
 *   - Tema editorial terang: paper #eceeeb di luar, kartu putih, ink #14181d,
 *     aksen hijau tua #0e8f63, CTA gradient brand #5EE89C → #2DE0D6.
 *   - Font sistem (bukan webfont) supaya konsisten di Gmail/Outlook.
 *   - Subject tanpa emoji; copy English.
 *
 * Semua method render murni (string HTML) — tidak menyentuh DB. Data template
 * dibekukan sebagai payload Json di EmailNotificationLog saat enqueue, worker
 * tinggal render + kirim batch.
 */

// ── Payload types (disimpan sebagai snapshot di EmailNotificationLog.payload) ──

export interface AnnouncementPayload {
  kind: 'announcement';
  title: string;
  org: string;
  rewardPool: string;
  winnersLabel: string;
  endsLabel: string;
  tasksLabel: string;
  campaignUrl: string;
}

export interface WinnerPayload {
  kind: 'winner';
  title: string;
  /** displayName atau @username penerima. */
  handle: string;
  /** "50 CC" | "25 USDCx" | "1 Invite Code" — sesuai rewardVariant WinnerDraw. */
  rewardLabel: string;
  /** "Sep 12, 2026" atau teks fallback bila quest tanpa deadline. */
  claimByLabel: string;
  claimUrl: string;
}

export interface NotSelectedPayload {
  kind: 'not_selected';
  title: string;
  /** "4 campaigns open right now" */
  liveLabel: string;
  exploreUrl: string;
}

export type CampaignEmailPayload =
  | AnnouncementPayload
  | WinnerPayload
  | NotSelectedPayload;

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_FROM = 'CanQuest <noreply@canquest.cc>';
/** Batas Resend batch endpoint per request.
 * @see https://resend.com/docs/api-reference/emails/send-batch-emails */
const RESEND_BATCH_LIMIT = 100;

@Injectable()
export class CampaignEmailService {
  private readonly logger = new Logger(CampaignEmailService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('RESEND_API_KEY')?.trim());
  }

  /** Kill-switch global (EMAIL_NOTIFICATIONS_ENABLED="false" mematikan semua). */
  isEnabled(): boolean {
    if (this.config.get<string>('EMAIL_NOTIFICATIONS_ENABLED') === 'false') {
      return false;
    }
    return this.isConfigured();
  }

  getChunkSize(): number {
    const raw = Number(
      this.config.get<string>('EMAIL_NOTIFY_CHUNK_SIZE') ?? '100',
    );
    if (!Number.isFinite(raw) || raw < 1) return 100;
    return Math.min(Math.floor(raw), RESEND_BATCH_LIMIT);
  }

  getChunkDelayMs(): number {
    const raw = Number(
      this.config.get<string>('EMAIL_NOTIFY_CHUNK_DELAY_MS') ?? '1000',
    );
    return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
  }

  private get from(): string {
    return (
      this.config.get<string>('RESEND_FROM_EMAIL_NOTIFICATIONS')?.trim() ||
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() ||
      DEFAULT_FROM
    );
  }

  private get webOrigin(): string {
    const explicit = this.config.get<string>('WEB_ORIGIN')?.trim();
    // WEB_ORIGIN bisa berupa daftar koma (CORS) — email CTA butuh satu origin:
    // pakai entri pertama.
    const first = explicit?.split(',')[0]?.trim();
    if (first) return first.replace(/\/+$/, '');
    return process.env.NODE_ENV === 'production'
      ? 'https://app.canquest.com'
      : 'http://localhost:3000';
  }

  /** URL absolut ke dApp web (CTA email + link preferences). */
  webUrl(path: string): string {
    return `${this.webOrigin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // ── Render (subject + html) per type ───────────────────────────────────────

  render(type: EmailNotificationType, payload: unknown): OutgoingEmail {
    const p = (payload ?? {}) as CampaignEmailPayload;
    switch (type) {
      case 'CAMPAIGN_ANNOUNCEMENT':
        if (p.kind !== 'announcement') break;
        return this.renderAnnouncement(p);
      case 'CAMPAIGN_WINNER':
        if (p.kind !== 'winner') break;
        return this.renderWinner(p);
      case 'CAMPAIGN_NOT_SELECTED':
        if (p.kind !== 'not_selected') break;
        return this.renderNotSelected(p);
    }
    // Payload rusak/tidak cocok type — jangan crash worker; email fallback netral.
    this.logger.warn(`Payload mismatch for ${type} — fallback generic email`);
    return {
      to: '',
      subject: 'CanQuest',
      html: this.wrap(
        `<div style="padding:28px 30px;">
           <h1 style="margin:0 0 8px;font-size:20px;line-height:1.35;color:#14181d;font-weight:700;">CanQuest</h1>
           <p style="margin:0 0 20px;font-size:13.5px;line-height:1.65;color:#5c6169;">Open your dApp dashboard for the latest updates.</p>
         </div>`,
      ),
    };
  }

  private renderAnnouncement(p: AnnouncementPayload): OutgoingEmail {
    const esc = escapeHtml;
    const statRow = (label: string, value: string, last = false) => `
      <tr${last ? '' : ` style="border-bottom:1px solid #eceeeb;"`}>
        <td style="padding:11px 0;font-size:12px;color:#8a8f98;">${esc(label)}</td>
        <td style="padding:11px 0;font-size:12.5px;font-weight:600;color:#14181d;text-align:right;font-family:ui-monospace,'IBM Plex Mono',Menlo,monospace;">${esc(value)}</td>
      </tr>`;

    const body = `
      <div style="padding:28px 30px 6px;">
        ${this.headerHtml('Campaign live', '#0e8f63')}
        <div style="font-size:12px;color:#8a8f98;margin-bottom:16px;">
          <span style="color:#14181d;font-weight:600;">${esc(p.org)}</span> · Partner campaign on Canton Network
        </div>
        <h1 style="margin:0 0 8px;font-size:20px;line-height:1.35;color:#14181d;font-weight:700;">${esc(p.title)} is live</h1>
        <p style="margin:0 0 20px;font-size:13.5px;line-height:1.65;color:#5c6169;">
          Your wallet's already connected, so you can jump straight to the tasks below —
          finish them before the deadline to enter the reward raffle.
        </p>
        <div style="border:1px solid #e2e4e0;border-radius:10px;padding:2px 18px;margin-bottom:22px;background:#fafbfa;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${statRow('Reward pool', p.rewardPool)}
            ${statRow('Winners', p.winnersLabel)}
            ${statRow('Ends', p.endsLabel)}
            ${statRow('Time needed', p.tasksLabel, true)}
          </table>
        </div>
        ${this.ctaHtml('Join the campaign', p.campaignUrl)}
        <p style="font-size:12px;line-height:1.6;color:#8a8f98;border-top:1px solid #eceeeb;padding-top:14px;margin:22px 0 0;">
          Tasks are verified automatically and rewards settle on-chain. Full rules on the campaign page.
        </p>
      </div>`;

    return {
      to: '',
      subject: `New campaign: ${p.title} — ${p.rewardPool} up for grabs`,
      html: this.wrap(
        body,
        `${p.org} is live on CanQuest with a ${p.rewardPool} reward pool.`,
      ),
    };
  }

  private renderWinner(p: WinnerPayload): OutgoingEmail {
    const esc = escapeHtml;
    const body = `
      <div style="padding:28px 30px 6px;">
        ${this.headerHtml('Raffle · winner', '#0e8f63')}
        <h1 style="margin:0 0 8px;font-size:20px;line-height:1.35;color:#14181d;font-weight:700;">Your wallet was drawn, ${esc(p.handle)}</h1>
        <p style="margin:0 0 22px;font-size:13.5px;line-height:1.65;color:#5c6169;">
          The draw for <b style="color:#14181d;">${esc(p.title)}</b> just closed, and you're one of the winners.
        </p>
        <div style="border:1px dashed #c7cbc5;border-radius:10px;padding:18px 20px;margin-bottom:18px;">
          <div style="font-size:11px;letter-spacing:.06em;color:#8a8f98;text-transform:uppercase;">Reward</div>
          <div style="font-size:32px;font-weight:700;color:#14181d;letter-spacing:-.01em;margin-top:6px;font-family:ui-monospace,'IBM Plex Mono',Menlo,monospace;">${esc(p.rewardLabel)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #c7cbc5;margin-top:14px;">
            <tr>
              <td style="padding-top:10px;font-size:11.5px;color:#8a8f98;">Settles on-chain</td>
              <td style="padding-top:10px;font-size:11.5px;color:#8a8f98;text-align:right;">${esc(p.claimByLabel)}</td>
            </tr>
          </table>
        </div>
        ${this.ctaHtml('Claim your reward', p.claimUrl)}
        <p style="text-align:center;font-size:11.5px;color:#8a8f98;margin:8px 0 20px;">
          Reward status also shows in your dApp dashboard.
        </p>
        <p style="font-size:12px;line-height:1.6;color:#8a8f98;border-top:1px solid #eceeeb;padding-top:14px;margin:0;">
          If this campaign has a claim fee, it's shown before you confirm. CanQuest staff will never ask for your seed phrase.
        </p>
      </div>`;

    return {
      to: '',
      subject: `You won the ${p.title}`,
      html: this.wrap(
        body,
        `Your wallet was selected in the draw — claim your ${p.rewardLabel} before the window closes.`,
      ),
    };
  }

  private renderNotSelected(p: NotSelectedPayload): OutgoingEmail {
    const esc = escapeHtml;
    const body = `
      <div style="padding:28px 30px 6px;">
        ${this.headerHtml('Raffle · results', '#8a8f98')}
        <h1 style="margin:0 0 8px;font-size:20px;line-height:1.35;color:#14181d;font-weight:700;">Not your draw this time</h1>
        <p style="margin:0 0 18px;font-size:13.5px;line-height:1.65;color:#5c6169;">
          Thanks for completing <b style="color:#14181d;">${esc(p.title)}</b>. The winners have been drawn, and
          your wallet wasn't selected in this round.
        </p>
        <div style="border-left:2px solid #e2e4e0;padding:2px 0 2px 14px;margin-bottom:22px;">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#5c6169;">
            Points from the tasks you have completed will remain saved in your account — and new campaigns
            have arrived on CanQuest, some offering instant rewards on a first-come, first-served basis.
          </p>
        </div>
        ${this.ctaHtml('Explore live campaigns', p.exploreUrl)}
        <p style="text-align:center;font-size:11.5px;color:#8a8f98;margin:8px 0 20px;">
          ${esc(p.liveLabel)}
        </p>
        <p style="font-size:12px;line-height:1.6;color:#8a8f98;border-top:1px solid #eceeeb;padding-top:14px;margin:0;">
          Raffle draws are random and final. You can turn off campaign emails anytime from the link below.
        </p>
      </div>`;

    return {
      to: '',
      subject: `Raffle results: ${p.title}`,
      html: this.wrap(
        body,
        `The draw is complete — you weren't selected this time, but new campaigns drop regularly.`,
      ),
    };
  }

  // ── Bagian template bersama ────────────────────────────────────────────────

  /** Baris header: logo kiri + label state kanan (table — flex tidak aman di Outlook). */
  private headerHtml(label: string, labelColor: string): string {
    const logoUrl = this.config.get<string>('EMAIL_LOGO_URL')?.trim();
    const logo = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="CanQuest" style="height:18px;width:auto;display:block;border:0;">`
      : `<span style="font-weight:700;font-size:15px;color:#14181d;letter-spacing:-.01em;">&#9670; CanQuest</span>`;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="left" valign="middle">${logo}</td>
          <td align="right" valign="middle" style="font-size:10.5px;font-weight:600;letter-spacing:.06em;color:${labelColor};text-transform:uppercase;">${escapeHtml(label)}</td>
        </tr>
      </table>`;
  }

  private ctaHtml(label: string, url: string): string {
    return `
      <div style="text-align:center;margin-bottom:22px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 30px;background:linear-gradient(135deg,#5EE89C 0%,#2DE0D6 100%);color:#04120b;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;">${escapeHtml(label)}</a>
      </div>`;
  }

  private wrap(bodyHtml: string, preheader?: string): string {
    const pre = preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
      : '';
    return `
      <!DOCTYPE html>
      <html lang="en">
      <body style="margin:0;padding:0;">
      ${pre}
      <div style="font-family:-apple-system,'Segoe UI',Inter,Arial,sans-serif;background:#eceeeb;padding:30px 14px;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e4e0;">
          ${bodyHtml}
          <div style="background:#f8f8f7;border-top:1px solid #eceeeb;padding:16px 30px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#9a9fa6;line-height:1.6;">
              You're getting this because you have a CanQuest account.
              <a href="${escapeHtml(`${this.webOrigin}/settings`)}" style="color:#5c6169;text-decoration:underline;">Manage email preferences</a>
            </p>
            <p style="margin:0;font-size:10.5px;color:#b3b7bd;">CanQuest · Built on Canton Network</p>
          </div>
        </div>
      </div>
      </body>
      </html>`;
  }

  // ── Pengiriman batch (Resend) ──────────────────────────────────────────────

  /**
   * Kirim batch via POST https://api.resend.com/emails/batch (maks 100/request).
   * All-or-nothing: jika response non-OK → throw (worker retry chunk yang sama;
   * baris log masih PENDING sehingga aman dikirim ulang).
   * Return id Resend per index (sesuai urutan messages) untuk audit.
   */
  async sendBatch(messages: OutgoingEmail[]): Promise<(string | null)[]> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('RESEND_API_KEY not set');
    }
    if (messages.length === 0) return [];
    if (messages.length > RESEND_BATCH_LIMIT) {
      throw new Error(
        `Batch too large: ${messages.length} > ${RESEND_BATCH_LIMIT}`,
      );
    }

    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        messages.map((m) => ({
          from: this.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
        })),
      ),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(
        `Resend batch failed (${res.status}): ${errText.slice(0, 200)}`,
      );
      throw new Error(`Resend batch failed (${res.status})`);
    }

    const data = (await res.json().catch(() => null)) as Array<{
      id?: string;
    }> | null;
    if (!Array.isArray(data)) return messages.map(() => null);
    return messages.map((_, i) => data[i]?.id ?? null);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
