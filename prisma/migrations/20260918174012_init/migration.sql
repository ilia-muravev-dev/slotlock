-- Range overlap checks and the exclusion strategy's constraint need btree_gist
-- (equality on a text column inside a GiST index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('ROOM', 'DESK_POOL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_FLIGHT', 'DONE');

-- CreateEnum
CREATE TYPE "PaymentEventOutcome" AS ENUM ('APPLIED', 'STALE', 'DUPLICATE', 'ORPHANED');

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "exclusive" BOOLEAN NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "holdExpiresAt" TIMESTAMPTZ(3),
    "paymentId" TEXT,
    "paymentLastEventAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_FLIGHT',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "PaymentEventOutcome" NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_jobs" (
    "key" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_jobs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_paymentId_key" ON "bookings"("paymentId");

-- CreateIndex
CREATE INDEX "bookings_resourceId_startsAt_endsAt_idx" ON "bookings"("resourceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "bookings_status_holdExpiresAt_idx" ON "bookings"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_idx" ON "payment_events"("paymentId");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_createdAt_idx" ON "outbox_events"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Overlap queries: "active bookings of this resource that intersect [from, to)".
CREATE INDEX "bookings_active_range_idx" ON "bookings"
  USING gist ("resourceId", tstzrange("startsAt", "endsAt"))
  WHERE "status" IN ('HELD', 'CONFIRMED');
