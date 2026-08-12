import { Controller, Get } from '@nestjs/common';
import { SkipAuth } from './auth/skip-auth.decorator';

@Controller()
export class AppController {
  @SkipAuth()
  @Get()
  health() {
    return { status: 'ok', service: 'vaulta-api' };
  }
}
