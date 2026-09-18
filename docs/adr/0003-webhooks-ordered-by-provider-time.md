# ADR 0003: Payment webhooks are ordered by the provider's clock, not by arrival

Status: accepted · 2026-09-18

## Context

A payment provider delivers webhooks at least once and in no particular order: retries duplicate
them, and `payment_intent.succeeded` can arrive before `payment_intent.processing` or after a
`payment_intent.canceled` that was created earlier. Applying events as they arrive turns a
confirmed booking back into a cancelled one, or confirms a hold that has already expired and
whose seat has been given to someone else.

## Decision

`POST /webhooks/payments` verifies the Stripe signature (the in-process fake PSP signs with the
same scheme, so there is one verification path), then `PaymentEventsService.apply` decides, in one
transaction with the booking row locked:

| Situation | Outcome | Effect |
| --- | --- | --- |
| event id already recorded (before or concurrently) | `DUPLICATE` | none |
| event type that changes nothing (`created`, `processing`, `payment_failed`) | `IGNORED` | none — a failed attempt may be retried until the hold expires |
| event older than `paymentLastEventAt` | `STALE` | none |
| `succeeded` / `canceled` on a `HELD` booking | `APPLIED` | `CONFIRMED` / `CANCELLED`, `paymentLastEventAt` advances |
| anything on a `CONFIRMED` booking | `STALE` | none — confirmed is terminal for payments |
| `succeeded` on a `CANCELLED` or `EXPIRED` booking | `ORPHANED` | recorded for a refund; the seat is not restored |
| no booking for the payment | `UNKNOWN` | recorded |

Every event is stored in `payment_events` with its outcome, so the log answers "what did this
webhook do?" and the response body says the same. All outcomes return 200; only a bad signature is
a 400, and only a database failure is a 5xx — the provider retries those, and the retry is safe.

## Consequences

- Any interleaving, with any duplicates, converges: the tests deliver whole sequences shuffled and
  concurrently and assert the same final state.
- Ordering by provider time needs the provider's timestamp on every event; Stripe's `created` is
  in seconds, so two events in the same second fall through to the state machine, which is
  order-independent for the two signals that matter.
- Orphaned money is a business event (refund), not a state transition: it leaves through the
  outbox (ADR 0004), never by re-seating the booking.
