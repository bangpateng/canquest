import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import Bull from 'bull';
type Job<T> = Bull.Job<T>;
import {
  QUEUE_EMAIL,
  JOB_CAMPAIGN_EMAIL_CHUNK,
} from '../queue/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignEmailService } from './campaign-email.service';

export interface CampaignEmailChunkPayload {
  logIds: string[];
}

/**
 * EmailJobProcessor — worker Bull queue `email-jobs`.
 *
 * Satu job = satu chunk (maks EMAIL_NOTIFY_CHUNK_SIZE baris, batas Resend 100).
 * Idempoten: baris di-read ulang WHERE status='PENDING' saat eksekusi —
 * job dobel / retry setelah sukses otomatis skip baris yang sudah SENT.
 *
 * Failure semantics: Resend batch bersifat all-or-nothing. Gagal → throw →
 * Bull retry (3x default dari QueueModule). Setelah attempt terakhir habis,
 * baris ditandai FAILED (audit; bisa di-retrigger manual dengan mereset
 * status ke PENDING lalu enqueue ulang).
 */
@Processor(QUEUE_EMAIL)
export class EmailJobProcessor {
  private readonly logger = new Logger(EmailJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: CampaignEmailService,
  ) {}

  @Process(JOB_CAMPAIGN_EMAIL_CHUNK)
  async processChunk(job: Job<CampaignEmailChunkPayload>): Promise<void> {
    const rows = await this.prisma.emailNotificationLog.findMany({
      where: { id: { in: job.data.logIds }, status: 'PENDING' },
    });
    if (rows.length === 0) return; // semua sudah terkirim/skip — job idempoten

    // Dev tanpa RESEND_API_KEY: tandai SKIPPED (hook tetap jalan, email log-only).
    if (!this.emails.isConfigured()) {
      await this.prisma.emailNotificationLog.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'SKIPPED', error: 'RESEND_API_KEY not set (dev mode)' },
      });
      this.logger.log(
        `[Job ${job.id}] Dev log-only: ${rows.length} email campaign ditandai SKIPPED`,
      );
      return;
    }

    this.logger.log(
      `[Job ${job.id}] Sending campaign emails: ${rows.length} (attempt ${job.attemptsMade + 1})`,
    );

    try {
      const messages = rows.map((r) => ({
        ...this.emails.render(r.type, r.payload),
        to: r.email,
      }));
      const ids = await this.emails.sendBatch(messages);

      const now = new Date();
      for (let i = 0; i < rows.length; i++) {
        await this.prisma.emailNotificationLog.update({
          where: { id: rows[i].id },
          data: {
            status: 'SENT',
            sentAt: now,
            resendId: ids[i] ?? null,
            error: null,
          },
        });
      }
      this.logger.log(`[Job ${job.id}] ✅ ${rows.length} campaign emails sent`);
    } catch (err) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? 3);
      if (isFinalAttempt) {
        await this.prisma.emailNotificationLog.updateMany({
          where: { id: { in: rows.map((r) => r.id) }, status: 'PENDING' },
          data: { status: 'FAILED', error: String(err).slice(0, 500) },
        });
        this.logger.error(
          `[Job ${job.id}] ❌ Campaign emails FAILED (final attempt): ${String(err)}`,
        );
        return; // jangan throw lagi — sudah dicatat FAILED
      }
      throw err; // Bull retry dengan backoff
    }
  }
}
