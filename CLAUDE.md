# slotlock — notes for coding agents

NestJS 12 on Fastify, Prisma 7 (pg driver adapter, generated client committed under
`src/generated/prisma`), Postgres 17, Redis + BullMQ, Zod 4, Vitest (SWC for decorators),
Testcontainers, fast-check, k6.

## Commands
- `just up` — Postgres + Redis; `just migrate`, `just seed`, `just api` (Swagger at /docs), `just worker`
- `just app` — the whole stack in Docker; `just demo` — the walkthrough against :3000
- `just check` — Biome, tsc, migration drift, Vitest unit + integration (integration tests start
  containers and boot the API and the worker in-process; Docker needed)
- `just bench <strategy>` / `just bench-all` — the k6 race and the verifier; writes docs/benchmarks/
- `pnpm prisma migrate dev --name <name>` after schema changes; hand-written SQL (extensions,
  exclusion constraints) goes into the migration file — Prisma's schema does not model it
- `pnpm prisma:generate` after schema changes (the generated client is committed)
- Dev and bench run the API with `node -r @swc-node/register` — tsx cannot emit the decorator
  metadata Nest's DI needs; tests use unplugin-swc for the same reason

## Rules of the codebase
- Every invariant has a test that fails without its mechanism (the race, idempotency, webhook
  ordering, hold expiry, exactly-once consumers). A change that weakens a mechanism must make
  that test red first.
- The five reserve strategies share one interface and are selected by `BOOKING_STRATEGY`; the
  exclusion constraint is toggled at startup so the others are measured without it. `naive` is
  the control and must stay broken.
- Postgres errors reach us in three shapes under Prisma 7; always go through `pgCode()` and
  `isRetryableConflict()` in `src/common/errors.ts`, never match on messages in place.
- Anything that updates a booking row after a reserve runs through `retryOnConflict` (the
  exclusion constraint is rechecked on non-HOT updates and can make them deadlock victims).
- HTTP semantics are part of the contract: 201 booked, 409 no capacity / request in flight,
  422 idempotency key reused with a different body, 400 validation.
- Webhooks are applied by provider timestamp, deduplicated by event id, and never regress a
  CONFIRMED booking. Handlers return 200 fast; work happens in a transaction.
- Numbers in the README come only from `docs/benchmarks/` written by `bench/run.ts`; regenerate
  with `just bench-all` after touching a strategy and update the README's reading of them.

## Review checklist for PRs
- Does the test prove the invariant, or only that the code ran?
- Any new write path: is it inside the transaction with the outbox event?
- Any new queue consumer: is it idempotent under duplicate delivery?
