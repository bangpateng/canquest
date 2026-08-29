import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { PartnersService } from './partners.service';

@Controller('partners')
@UseGuards(AuthGuard('jwt'))
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /** Daftar partner ecosystem (published) — ?category= & ?q= opsional. */
  @SkipThrottle()
  @Get()
  list(
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    return this.partners.listPublished(category, q);
  }

  /** Detail partner (modal ecosystem). */
  @SkipThrottle()
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.partners.getById(id);
  }
}
