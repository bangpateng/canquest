import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_FROM = 'Naxweb Verification <noreply@canquest.cc>';

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('RESEND_API_KEY')?.trim());
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email verification is not configured (RESEND_API_KEY).',
        );
      }
      this.logger.warn(`[dev] OTP for ${to}: ${code} (RESEND_API_KEY not set)`);
      return;
    }

    const from =
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Your CanQuest verification code',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 12px">CanQuest verification</h2>
            <p style="color:#555;margin:0 0 20px">Enter this 6-digit code to continue. It expires in 15 minutes.</p>
            <p style="font-size:32px;font-weight:700;letter-spacing:0.25em;margin:0">${code}</p>
            <p style="color:#888;font-size:12px;margin-top:24px">If you did not request this, you can ignore this email.</p>
          </div>
        `.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(
        `Resend failed (${res.status}): ${errText.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'Could not send verification email. Try again later.',
      );
    }
  }

  /** Password reset code (6 digit). Mirrors sendOtpEmail structure. */
  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email service is not configured (RESEND_API_KEY).',
        );
      }
      this.logger.warn(
        `[dev] Reset code for ${to}: ${code} (RESEND_API_KEY not set)`,
      );
      return;
    }

    const from =
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Reset your CanQuest password',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 12px">Reset your CanQuest password</h2>
            <p style="color:#555;margin:0 0 20px">Use this 6-digit code to choose a new password. It expires in 15 minutes.</p>
            <p style="font-size:32px;font-weight:700;letter-spacing:0.25em;margin:0">${code}</p>
            <p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email — your password stays unchanged.</p>
          </div>
        `.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(
        `Reset email failed (${res.status}): ${errText.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'Could not send reset email. Try again later.',
      );
    }
  }

  /**
   * Best-effort notification after a password change. Never throws — callers `void ...catch()`
   * so email failure does not roll back a successful reset.
   */
  async sendPasswordChangedEmail(to: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      // Non-prod: just log. Best-effort, never throw.
      this.logger.warn(
        `[dev] Password-changed notice for ${to} (RESEND_API_KEY not set)`,
      );
      return;
    }

    const from =
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: 'Your CanQuest password was changed',
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="margin:0 0 12px">Password changed</h2>
              <p style="color:#555;margin:0">Your CanQuest password was just changed. If this was you, no further action is needed.</p>
              <p style="color:#555;margin:12px 0 0">If this wasn't you, contact support immediately.</p>
            </div>
          `.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(
          `Password-changed email failed (${res.status}): ${errText.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Password-changed email error for ${to}: ${String(err)}`,
      );
    }
  }
}
