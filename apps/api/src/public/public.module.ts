import { Module } from '@nestjs/common';
import { QuestsModule } from '../quests/quests.module';
import { ResendEmailService } from '../auth/resend-email.service';
import { PublicController } from './public.controller';

@Module({
  // ResendEmailService is also provided here (no shared state) so the public contact
  // endpoint can send email without importing the whole AuthModule (which carries
  // JwtStrategy etc.). ConfigService is global via ConfigModule.forRoot.
  imports: [QuestsModule],
  controllers: [PublicController],
  providers: [ResendEmailService],
})
export class PublicModule {}
