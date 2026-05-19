import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  ok() {
    return { ok: true, service: 'canquest-api', ts: new Date().toISOString() };
  }
}
