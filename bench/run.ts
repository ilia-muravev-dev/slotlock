// `pnpm bench <strategy|all>`: fresh database, the API under that strategy, the k6 race, the
// verifier, a report. Numbers in docs/benchmarks come only from here.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { seed } from '../prisma/seed';
import { STRATEGIES, type Strategy } from '../src/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { type Verdict, verify } from './verify';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'benchmarks');
const PORT = Number(process.env.BENCH_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const VUS = Number(process.env.BENCH_VUS ?? 100);
const DURATION = process.env.BENCH_DURATION ?? '20s';
const RELEASE_RATIO = Number(process.env.BENCH_RELEASE_RATIO ?? 0.8);
const POOL_SIZE = Number(process.env.DATABASE_POOL_SIZE ?? 20);

interface Report {
  strategy: Strategy;
  at: string;
  commit: string;
  machine: string;
  node: string;
  postgres: string;
  poolSize: number;
  vus: number;
  duration: string;
  releaseRatio: number;
  requests: number;
  rps: number;
  created: number;
  conflict: number;
  failed: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number; avg: number };
  reserve: { attempts: number; retries: number } | null;
  verdict: Verdict;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (see .env.example)');
  return url;
}

async function resetDatabase(): Promise<string> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE bookings, idempotency_keys, payment_events, outbox_events, processed_jobs, fake_payment_intents, resources RESTART IDENTITY CASCADE',
    );
    await seed(prisma);
    const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    const version = rows[0]?.version ?? 'PostgreSQL ?';
    return version.split(' on ')[0] ?? version;
  } finally {
    await prisma.$disconnect();
  }
}

function startApi(strategy: Strategy): ChildProcess {
  const child = spawn('node', ['-r', '@swc-node/register', 'src/main.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      PORT: String(PORT),
      BOOKING_STRATEGY: strategy,
      DATABASE_POOL_SIZE: String(POOL_SIZE),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return child;
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} did not come up in ${timeoutMs} ms`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return; // already gone (a signal leaves exitCode null)
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5000).unref();
  });
}

function runK6(summaryPath: string): void {
  execFileSync(
    'k6',
    [
      'run',
      '--quiet',
      '--env',
      `BASE_URL=${BASE}`,
      '--env',
      `BENCH_VUS=${VUS}`,
      '--env',
      `BENCH_DURATION=${DURATION}`,
      '--env',
      `BENCH_RELEASE_RATIO=${RELEASE_RATIO}`,
      '--env',
      `SUMMARY_PATH=${summaryPath}`,
      'bench/race.js',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

function readSummary(
  summaryPath: string,
): Pick<Report, 'requests' | 'rps' | 'created' | 'conflict' | 'failed' | 'latencyMs'> {
  const data = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
    metrics: Record<string, { values?: Record<string, number> }>;
  };
  const v = (name: string, key: string): number => data.metrics[name]?.values?.[key] ?? 0;
  return {
    requests: v('http_reqs', 'count'),
    rps: v('http_reqs', 'rate'),
    created: v('bookings_created', 'count'),
    conflict: v('bookings_conflict', 'count'),
    failed: v('bookings_failed', 'count'),
    latencyMs: {
      p50: v('reserve_latency', 'med'),
      p95: v('reserve_latency', 'p(95)'),
      p99: v('reserve_latency', 'p(99)'),
      max: v('reserve_latency', 'max'),
      avg: v('reserve_latency', 'avg'),
    },
  };
}

export async function bench(strategy: Strategy): Promise<Report> {
  mkdirSync(OUT, { recursive: true });
  const postgres = await resetDatabase();
  const api = startApi(strategy);
  try {
    await waitFor(`${BASE}/health`);
    const summaryPath = path.join(os.tmpdir(), `slotlock-k6-${strategy}.json`);
    console.log(`\n== ${strategy}: ${VUS} VUs for ${DURATION}, release ratio ${RELEASE_RATIO}`);
    runK6(summaryPath);
    const health = (await (await fetch(`${BASE}/health`)).json()) as { reserve: Report['reserve'] };
    await stop(api);
    const verdict = await verify(databaseUrl());
    const report: Report = {
      strategy,
      at: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
        .toString()
        .trim(),
      machine: `${os.cpus()[0]?.model ?? 'unknown cpu'} (${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB), ${os.platform()} ${os.arch()}`,
      node: process.version,
      postgres,
      poolSize: POOL_SIZE,
      vus: VUS,
      duration: DURATION,
      releaseRatio: RELEASE_RATIO,
      ...readSummary(summaryPath),
      reserve: health.reserve,
      verdict,
    };
    writeFileSync(path.join(OUT, `${strategy}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(path.join(OUT, `${strategy}.md`), renderReport(report));
    console.log(
      `verdict: ${verdict.ok ? 'OK' : 'VIOLATED'} — overlaps=${verdict.overlaps} overCapacity=${verdict.overCapacity} bookings=${verdict.bookings}`,
    );
    return report;
  } finally {
    await stop(api);
  }
}

const ms = (n: number) => n.toFixed(1);

function renderReport(r: Report): string {
  return `# Benchmark: \`${r.strategy}\`

Measured ${r.at} at commit \`${r.commit}\` on ${r.machine}, Node ${r.node}, ${r.postgres} in Docker, pool size ${r.poolSize}.
k6 \`constant-vus\`: ${r.vus} VUs for ${r.duration}; each iteration books a random seat (5 rooms × 20 slots, 10 % desk pool) with a fresh Idempotency-Key and releases it with probability ${r.releaseRatio}.

| Metric | Value |
| --- | --- |
| Requests | ${r.requests} (${r.rps.toFixed(1)} req/s, bookings and cancels) |
| 201 created / 409 conflict / other | ${r.created} / ${r.conflict} / ${r.failed} |
| POST /bookings latency p50 / p95 / p99 / max | ${ms(r.latencyMs.p50)} / ${ms(r.latencyMs.p95)} / ${ms(r.latencyMs.p99)} / ${ms(r.latencyMs.max)} ms |
| Reserve attempts / retries | ${r.reserve ? `${r.reserve.attempts} / ${r.reserve.retries}` : 'n/a (no retry loop)'} |
| Verifier: overlapping room bookings / pool over capacity | ${r.verdict.overlaps} / ${r.verdict.overCapacity} — **${r.verdict.ok ? 'invariants held' : 'INVARIANTS VIOLATED'}** |
| Bookings in the table at the end (active) | ${r.verdict.bookings} (${r.verdict.activeNow}) |
`;
}

export function renderTable(reports: Report[]): string {
  const first = reports[0];
  const rows = reports
    .map(
      (r) =>
        `| \`${r.strategy}\` | ${r.rps.toFixed(0)} | ${ms(r.latencyMs.p50)} | ${ms(r.latencyMs.p95)} | ${ms(r.latencyMs.p99)} | ${r.created} / ${r.conflict} / ${r.failed} | ${r.reserve ? r.reserve.retries : '–'} | ${r.verdict.overlaps} / ${r.verdict.overCapacity} | ${r.verdict.ok ? '✅' : '❌'} |`,
    )
    .join('\n');
  return `# Benchmarks

Same k6 race for every strategy (\`bench/race.js\`), judged by \`bench/verify.ts\` from the database alone. Regenerate with \`just bench-all\`; the numbers here are whatever the last run produced, never edited by hand.

${first ? `Last run: ${first.at}, commit \`${first.commit}\`, ${first.machine}, Node ${first.node}, ${first.postgres} in Docker, pool size ${first.poolSize}. ${first.vus} VUs for ${first.duration} per strategy, release ratio ${first.releaseRatio}.` : ''}

| Strategy | req/s | p50 ms | p95 ms | p99 ms | 201 / 409 / other | retries | overlaps / over capacity | invariants |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- | :---: |
${rows}

- **req/s** counts bookings and the cancels that keep the seats contended; latency is \`POST /bookings\` only.
- **retries** are the reserve loop's second and later attempts (optimistic version conflicts, serialization failures, deadlock victims); the lock strategies wait instead.
- \`naive\` is the control: check-then-insert with nothing holding the two together. Its row is the bug the other five exist to prevent.

Per-strategy reports: ${reports.map((r) => `[${r.strategy}](${r.strategy}.md)`).join(', ')}.
`;
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'all';
  const strategies = target === 'all' ? [...STRATEGIES] : [target as Strategy];
  for (const s of strategies) {
    if (!STRATEGIES.includes(s))
      throw new Error(`unknown strategy ${s}; one of ${STRATEGIES.join(', ')} or all`);
  }
  const reports: Report[] = [];
  for (const strategy of strategies) reports.push(await bench(strategy));
  if (target === 'all') {
    writeFileSync(path.join(OUT, 'README.md'), renderTable(reports));
    console.log(`\nwrote ${path.join(OUT, 'README.md')}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
