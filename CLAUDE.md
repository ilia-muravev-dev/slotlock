# slotlock — notes for coding agents

NestJS 12 on Fastify, Prisma 7 (pg driver adapter, generated client committed under
`src/generated/prisma`), Postgres 17, Redis + BullMQ, Zod 4, Vitest (SWC for decorators),
Testcontainers, fast-check, k6.

## Commands
- `just up` — Postgres + Redis; `just migrate`, `just seed`, `just api` (Swagger at /docs), `just worker`
- `just check` — Biome, tsc, Vitest unit + integration (integration tests start containers; Docker needed)
- `pnpm prisma migrate dev --name <name>` after schema changes; hand-written SQL (extensions,
  exclusion constraints) goes into the migration file — Prisma's schema does not model it
- `pnpm prisma:generate` after schema changes (the generated client is committed)

## Rules of the codebase
- Every invariant has a test that fails without its mechanism (the race, idempotency, webhook
  ordering, hold expiry, exactly-once consumers). A change that weakens a mechanism must make
  that test red first.
- The five reserve strategies share one interface and are selected by `BOOKING_STRATEGY`; the
  exclusion constraint is toggled at startup so the others are measured without it.
- HTTP semantics are part of the contract: 201 booked, 409 no capacity / request in flight,
  422 idempotency key reused with a different body, 400 validation.
- Webhooks are applied by provider timestamp, deduplicated by event id, and never regress a
  CONFIRMED booking. Handlers return 200 fast; work happens in a transaction.
- Numbers in the README come only from `docs/benchmarks/` written by `bench/run.ts`.

## Review checklist for PRs
- Does the test prove the invariant, or only that the code ran?
- Any new write path: is it inside the transaction with the outbox event?
- Any new queue consumer: is it idempotent under duplicate delivery?
