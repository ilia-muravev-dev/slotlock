# Benchmarks

Same k6 race for every strategy (`bench/race.js`), judged by `bench/verify.ts` from the database alone. Regenerate with `just bench-all`; the numbers here are whatever the last run produced, never edited by hand.

Last run: 2026-09-18T18:57:11.898Z, commit `2b1bbff`, Apple M1 Pro (8 cores, 16 GB), darwin arm64, Node v24.21.0, PostgreSQL 17.11 in Docker, pool size 20. 100 VUs for 20s per strategy, release ratio 0.8.

| Strategy | req/s | p50 ms | p95 ms | p99 ms | 201 / 409 / other | retries | overlaps / over capacity | invariants |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- | :---: |
| `advisory` | 1416 | 66.6 | 92.6 | 138.0 | 1106 / 26359 / 0 | – | 0 / 0 | ✅ |
| `for_update` | 1407 | 66.9 | 91.9 | 138.8 | 1062 / 26261 / 0 | – | 0 / 0 | ✅ |
| `optimistic` | 1405 | 64.9 | 89.8 | 206.3 | 909 / 26499 / 34 | 1078 | 0 / 0 | ✅ |
| `serializable` | 1508 | 60.0 | 80.7 | 174.4 | 981 / 28437 / 9 | 944 | 0 / 0 | ✅ |
| `exclusion` | 1867 | 49.4 | 70.9 | 126.2 | 1019 / 35545 / 0 | 0 | 0 / 0 | ✅ |
| `naive` | 1643 | 57.1 | 75.5 | 114.2 | 1070 / 30992 / 0 | – | 18 / 5 | ❌ |

- **req/s** counts bookings and the cancels that keep the seats contended; latency is `POST /bookings` only.
- **retries** are the reserve loop's second and later attempts (optimistic version conflicts, serialization failures, deadlock victims); the lock strategies wait instead.
- `naive` is the control: check-then-insert with nothing holding the two together. Its row is the bug the other five exist to prevent.

Per-strategy reports: [advisory](advisory.md), [for_update](for_update.md), [optimistic](optimistic.md), [serializable](serializable.md), [exclusion](exclusion.md), [naive](naive.md).
