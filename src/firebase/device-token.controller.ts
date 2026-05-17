import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class DeviceTokenController {
  constructor(private prisma: PrismaService) {}

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  async registerToken(
    @CurrentUser() user: { id: string },
    @Body() body: { token: string },
  ) {
    if (!body.token) return { ok: false, error: 'token is required' };

    const existing = await this.prisma.deviceToken.findFirst({
      where: { userId: user.id, token: body.token },
    })

    if (existing) {
      await this.prisma.deviceToken.update({
        where: { id: existing.id },
        data: { token: body.token },
      })
    } else {
      await this.prisma.deviceToken.create({
        data: { userId: user.id, token: body.token },
      })
    }
    return { ok: true };
  }
}
