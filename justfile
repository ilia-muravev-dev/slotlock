# slotlock task runner — `just` lists the recipes.

default:
    @just --list

# Postgres + Redis
up:
    docker compose up -d --wait db redis

# Stop everything
down:
    docker compose down

# Apply migrations to DATABASE_URL
migrate:
    pnpm prisma migrate deploy

# Create a migration from schema changes (dev only)
migrate-dev name:
    pnpm prisma migrate dev --name {{name}}

# Seed rooms and desk pools
seed:
    pnpm prisma:seed

# API with reload on :3000 (Swagger at /docs)
api:
    pnpm dev

# Worker with reload
worker:
    pnpm dev:worker

# Lint, types, migration drift, unit + integration tests (integration needs Docker)
check:
    pnpm lint && pnpm typecheck && pnpm prisma validate && pnpm prisma:drift && pnpm test

# Fix what Biome can fix
fix:
    pnpm lint:fix

# k6 race against one strategy (needs `brew install k6`, `just up`, `just migrate`); report in docs/benchmarks/
bench strategy:
    pnpm bench {{strategy}}

# All six strategies, then the comparison table docs/benchmarks/README.md
bench-all:
    pnpm bench all

# Judge the current database: overlaps and over-capacity pools
verify:
    pnpm bench:verify
