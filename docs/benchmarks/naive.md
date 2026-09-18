# Benchmark: `naive`

Measured 2026-09-18T18:59:00.327Z at commit `2b1bbff` on Apple M1 Pro (8 cores, 16 GB), darwin arm64, Node v24.21.0, PostgreSQL 17.11 in Docker, pool size 20.
k6 `constant-vus`: 100 VUs for 20s; each iteration books a random seat (5 rooms × 20 slots, 10 % desk pool) with a fresh Idempotency-Key and releases it with probability 0.8.

| Metric | Value |
| --- | --- |
| Requests | 32927 (1643.4 req/s, bookings and cancels) |
| 201 created / 409 conflict / other | 1070 / 30992 / 0 |
| POST /bookings latency p50 / p95 / p99 / max | 57.1 / 75.5 / 114.2 / 450.0 ms |
| Reserve attempts / retries | n/a (no retry loop) |
| Verifier: overlapping room bookings / pool over capacity | 18 / 5 — **INVARIANTS VIOLATED** |
| Bookings in the table at the end (active) | 1070 (205) |
