import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Used by `migrate dev` and by the drift check (`migrate diff --from-migrations`).
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
