import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'packages/database/prisma/schema.prisma',
  migrations: { path: 'packages/database/prisma/migrations' },
  datasource: {
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      'postgresql://gitorbit:gitorbit@localhost:5432/gitorbit',
  },
});
