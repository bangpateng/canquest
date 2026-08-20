import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QUEUE_EMAIL } from '../queue/queue.constants';
import { CampaignEmailService } from './campaign-email.service';
import { NotificationsService } from './notifications.service';
import { EmailJobProcessor } from './email-job.processor';

/**
 * NotificationsModule — email notifikasi campaign (v32).
 *
 * Queue `email-jobs` didaftarkan di sini (bukan di QueueModule) supaya tidak
 * terjadi circular import: NotificationsService hanya butuh handle queue ini,
 * sedangkan QueueModule sudah meng-export BullModule terkonfigurasi (Redis).
 *
 * Pemakai (AdminModule dst.) cukup import NotificationsModule lalu inject
 * NotificationsService — semua method best-effort, tidak pernah throw ke caller.
 */
@Module({
  imports: [
    QueueModule,
    PrismaModule,
    BullModule.registerQueue({ name: QUEUE_EMAIL }),
  ],
  providers: [CampaignEmailService, NotificationsService, EmailJobProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
