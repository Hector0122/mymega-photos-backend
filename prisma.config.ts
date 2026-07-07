import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || '';
  // Railway internal PostgreSQL does not require TLS
  if (url.includes('railway.internal') && !url.includes('sslmode=')) {
    return url + '?sslmode=disable';
  }
  return url;
}

export default defineConfig({
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: getDatabaseUrl(),
  },
});
