# Benchmark: `exclusion`

Measured 2026-09-18T18:58:38.718Z at commit `2b1bbff` on Apple M1 Pro (8 cores, 16 GB), darwin arm64, Node v24.21.0, PostgreSQL 17.11 in Docker, pool size 20.
k6 `constant-vus`: 100 VUs for 20s; each iteration books a random seat (5 rooms × 20 slots, 10 % desk pool) with a fresh Idempotency-Key and releases it with probability 0.8.

| Metric | Value |
| --- | --- |
| Requests | 37383 (1866.6 req/s, bookings and cancels) |
| 201 created / 409 conflict / other | 1019 / 35545 / 0 |
| POST /bookings latency p50 / p95 / p99 / max | 49.4 / 70.9 / 126.2 / 345.7 ms |
| Reserve attempts / retries | 32800 / 0 |
| Verifier: overlapping room bookings / pool over capacity | 0 / 0 — **invariants held** |
| Bookings in the table at the end (active) | 1019 (200) |
