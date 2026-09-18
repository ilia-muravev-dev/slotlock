# ADR 0004: A transactional outbox and an idempotent consumer, not "transactional" publishing

Status: accepted · 2026-09-18

## Context

Every booking transition has a side effect outside the database: a confirmation e-mail, a refund
for money that arrived after the seat was released, a message to a calendar. Publishing to the
queue from inside the request has two failure modes, and both happen: the row commits and the
publish fails (the customer never hears), or the publish succeeds and the commit fails (the
customer hears about a booking that does not exist). Wrapping the publish in the database
transaction does not help — the queue is not a participant in it.

## Decision

- **Outbox rows, in the transaction.** `OutboxService.enqueue(tx, type, payload)` writes an
  `outbox_events` row with the same `tx` that changes the booking (`booking.held` with the
  payment id, `booking.confirmed` / `booking.cancelled` with the webhook, `booking.expired` with
  the expiry update, `payment.orphaned` and `payment.refund_requested` where money and seat part
  ways). Either both are committed or neither.
- **A relay in the worker.** Every `OUTBOX_RELAY_INTERVAL_MS` a BullMQ job scheduler ticks the
  relay, which takes unpublished rows oldest first with `FOR UPDATE SKIP LOCKED` (several workers
  may relay), adds them to the `notifications` queue with `jobId = event id`, and marks them
  published in the same transaction. A crash between the add and the commit republishes the row
  on the next tick; BullMQ ignores a job id it still remembers, and if it no longer does the
  consumer catches it.
- **An idempotent consumer.** `NotificationsProcessor` claims the job id in `processed_jobs`
  inside a transaction, delivers, then commits. A redelivery finds the claim and returns
  `duplicate`. A delivery that throws rolls the claim back and BullMQ retries.

## Consequences

- Delivery is at least once and processing is exactly once, with one window left open on
  purpose: a crash after delivering and before the commit delivers twice. Closing it needs the
  sink itself to be idempotent (a provider message id derived from the event id), which is where
  that responsibility belongs.
- Ordering is per relay batch, not global: the consumer runs several jobs at a time. Consumers
  that need order (a calendar feed) key on the booking id and read the current state.
- The outbox table grows; published rows are safe to delete after a retention period. Not done
  here, on purpose — it is a cron job, not a design decision.
