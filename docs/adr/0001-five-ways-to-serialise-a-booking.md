# ADR 0001: Five ways to serialise a booking, all kept, one active

Status: accepted · 2026-09-18

## Context

Two requests for the same room and time can both pass a "is it free?" check and both insert. The
fix has to be in the database, and there are several correct ways to do it, each with a different
cost under contention and different failure behaviour:

| Strategy | How | Trade-off |
| --- | --- | --- |
| `advisory` | `pg_advisory_xact_lock(hash(resourceId))`, then count and insert | serialises per resource; no schema changes; the lock is invisible to the schema |
| `for_update` | lock the resource row with `SELECT … FOR UPDATE` | same effect, visible in the plan; needs the row to exist |
| `optimistic` | count and insert, then bump `Resource.version` with `WHERE version = seen`; retry on 0 rows | no waiting; retries under contention |
| `serializable` | the same transaction at `SERIALIZABLE`; retry on 40001 | the textbook answer; Postgres detects the conflict instead of the code |
| `exclusion` | `EXCLUDE USING gist (resourceId WITH =, tstzrange WITH &&)`; the insert fails with 23P01 | the database enforces non-overlap for exclusive resources; cannot express "at most N" |

## Decision

All five are implemented behind one `ReserveStrategy` interface and selected by
`BOOKING_STRATEGY`. The exclusion constraint is added or dropped at startup by the strategy module,
so the other four are measured without it. Pools (capacity N) always use `advisory` under the
exclusion strategy, and the results table says so. The benchmark (`bench/`) runs the same k6 race
against each and the README shows the numbers side by side.

A sixth, `naive`, is the bug itself — check, then insert, nothing holding the two together. It is
kept as the control: the race test proves it double-books and the benchmark shows what "no
locking" costs in correctness, not just in latency. The configuration refuses it in production.

## Consequences

- The exclusion strategy must insert with `ON CONFLICT ON CONSTRAINT … DO NOTHING`. A plain
  insert is checked *after* its index entry is written, so N concurrent inserts for one slot find
  each other's uncommitted rows, wait on each other, and are unpicked by the deadlock detector one
  `deadlock_timeout` (1 s) at a time — the first version of this repository answered the 50-way
  race with no 201 at all. Speculative insertion pre-checks before writing, so a committed winner
  makes the losers' inserts return no row, and nothing deadlocks.
- The constraint is also rechecked on every non-HOT update of a booking row (attaching the payment
  id, confirming), and that check waits on in-flight inserts for the same slot; what follows a
  reserve runs through `retryOnConflict` in case the detector picks it as the victim.

- One code path per strategy, one integration test parametrised over all five, one benchmark.
- Production would pick one (`advisory` by default); the others stay as living documentation of
  the trade-offs, which is the point of the repository.
