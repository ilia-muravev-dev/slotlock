# ADR 0002: Idempotency keys — in-flight is a conflict, answers are stored, a reused key is an error

Status: accepted · 2026-09-18

## Context

A client that times out on `POST /bookings` does not know whether the hold was made. If it
retries without protection it may hold the seat twice (and pay twice); if it gives up it may
lose a seat it already has. The retry has to be safe by construction, including the case where
the retry arrives while the first attempt is still running.

## Decision

`POST /bookings` requires an `Idempotency-Key` (1–128 characters), scoped to the `X-User-Id` so
two users cannot collide on `"1"`. The interceptor in `src/idempotency/`:

1. Inserts the key as `IN_FLIGHT` with a hash of `(user, method, path, body)` before the handler
   runs. The primary key is the fence: a concurrent insert of the same key fails with a unique
   violation and that request is answered **409 `request_in_flight`** — it must retry later, not
   wait, because the first attempt may be holding locks.
2. When the handler finishes, stores the status and body (2xx and 4xx alike) and marks the key
   `DONE`. A later request with the same key and the same hash gets the stored answer back with
   `Idempotency-Replayed: true` — a replayed 409 is still a 409: losing the race once is losing it.
3. A request with the same key and a different hash is **422 `idempotency_key_reused`**. Silently
   replaying the old answer would hide a client bug; silently running the new request would
   defeat the key.
4. A 5xx or a crash **releases** the key (the row is deleted) so the client's retry runs again.
   Whatever the failed attempt did to the seat is compensated by the handler itself (a hold whose
   payment intent could not be created is cancelled before the 502 leaves).
5. Keys expire after 24 hours; an expired key is simply a new key.

## Consequences

- The client contract is small: generate a key per attempt, reuse it on retry, treat 409
  `request_in_flight` as "back off and retry with the same key".
- Storing 4xx answers means validation errors are replayed too — deliberate: the answer to that
  exact request is that error, and replay is cheaper than re-validation.
- The key row is a second write per booking. It is the price of the guarantee; the benchmark
  numbers include it.
