# Benchmark: `optimistic`

Measured 2026-09-18T18:57:55.226Z at commit `2b1bbff` on Apple M1 Pro (8 cores, 16 GB), darwin arm64, Node v24.21.0, PostgreSQL 17.11 in Docker, pool size 20.
k6 `constant-vus`: 100 VUs for 20s; each iteration books a random seat (5 rooms × 20 slots, 10 % desk pool) with a fresh Idempotency-Key and releases it with probability 0.8.

| Metric | Value |
| --- | --- |
| Requests | 28151 (1405.0 req/s, bookings and cancels) |
| 201 created / 409 conflict / other | 909 / 26499 / 34 |
| POST /bookings latency p50 / p95 / p99 / max | 64.9 / 89.8 / 206.3 / 761.8 ms |
| Reserve attempts / retries | 28520 / 1078 |
| Verifier: overlapping room bookings / pool over capacity | 0 / 0 — **invariants held** |
| Bookings in the table at the end (active) | 909 (200) |
