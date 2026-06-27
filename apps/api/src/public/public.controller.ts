import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuestsService } from '../quests/quests.service';
import { ResendEmailService } from '../auth/resend-email.service';
import { ContactDto } from './contact.dto';

/** Unauthenticated marketing endpoints. */
@Controller('public')
export class PublicController {
  constructor(
    private readonly quests: QuestsService,
    private readonly mailer: ResendEmailService,
    private readonly config: ConfigService,
  ) {}

  @Get('quests')
  featuredQuests(@Query('limit') limit?: string) {
    const n = Math.min(12, Math.max(1, parseInt(limit ?? '6', 10) || 6));
    return this.quests.listFeaturedQuests(n);
  }

  @Get('leaderboard')
  leaderboard(
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const validPeriod = (['weekly', 'monthly', 'all'] as const).includes(
      period as 'weekly' | 'monthly' | 'all',
    )
      ? (period as 'weekly' | 'monthly' | 'all')
      : 'weekly';
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize ?? '10', 10) || 10));
    return this.quests.getLeaderboard(validPeriod, p, ps);
  }

  /**
   * Cooperation / partnership form submission. Forwards the payload to the team inbox
   * (TEAM_CONTACT_EMAIL, default team@canquest.cc) via Resend. Validation runs through
   * the global ValidationPipe; Turnstile is checked in the Next.js BFF route.
   */
  @Post('contact')
  @HttpCode(HttpStatus.OK)
  async submitContact(@Body() dto: ContactDto) {
    const to =
      this.config.get<string>('TEAM_CONTACT_EMAIL')?.trim() ||
      'team@canquest.cc';

    await this.mailer.sendContactSubmission(to, {
      name: dto.name,
      email: dto.email,
      organization: dto.organization ?? null,
      collaborationType: dto.collaborationType ?? null,
      budget: dto.budget ?? null,
      message: dto.message,
    });

    return { ok: true };
  }
}
