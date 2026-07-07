import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function normalizeConnectionString(raw: string): string {
  if (raw.includes('sslmode=')) return raw;
  const sep = raw.includes('?') ? '&' : '?';
  // Railway internal PostgreSQL does not use TLS
  if (raw.includes('railway.internal')) {
    return `${raw}${sep}sslmode=disable`;
  }
  return `${raw}${sep}sslmode=require`;
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
