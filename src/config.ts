import 'dotenv/config';
import { z } from 'zod';

export const STRATEGIES = [
  'advisory',
  'for_update',
  'optimistic',
  'serializable',
  'exclusion',
] as const;
export type Strategy = (typeof STRATEGIES)[number];

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379/0'),
  BOOKING_STRATEGY: z.enum(STRATEGIES).default('advisory'),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  STRIPE_WEBHOOK_SECRET: z.string().min(8).default('whsec_slotlock_dev'),
});

export type Config = z.infer<typeof schema>;

/** Validated once at startup; a wrong environment fails loudly before anything listens. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration — ${issues}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
