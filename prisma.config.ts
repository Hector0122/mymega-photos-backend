import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
  },
});
