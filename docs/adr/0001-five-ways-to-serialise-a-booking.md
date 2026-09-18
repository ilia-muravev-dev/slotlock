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

## Consequences

- One code path per strategy, one integration test parametrised over all five, one benchmark.
- Production would pick one (`advisory` by default); the others stay as living documentation of
  the trade-offs, which is the point of the repository.
