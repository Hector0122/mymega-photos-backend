import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function normalizeConnectionString(raw: string): string {
  if (!raw.includes('sslmode=')) {
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}sslmode=verify-full`;
  }
  return raw;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = normalizeConnectionString(
      process.env.DATABASE_URL || '',
    );
    const adapter = new PrismaPg(
      { connectionString },
      { schema: process.env.DATABASE_SCHEMA || 'public' },
    );
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
