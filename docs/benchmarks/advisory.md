# Benchmark: `advisory`

Measured 2026-09-18T18:57:11.898Z at commit `2b1bbff` on Apple M1 Pro (8 cores, 16 GB), darwin arm64, Node v24.21.0, PostgreSQL 17.11 in Docker, pool size 20.
k6 `constant-vus`: 100 VUs for 20s; each iteration books a random seat (5 rooms × 20 slots, 10 % desk pool) with a fresh Idempotency-Key and releases it with probability 0.8.

| Metric | Value |
| --- | --- |
| Requests | 28369 (1415.9 req/s, bookings and cancels) |
| 201 created / 409 conflict / other | 1106 / 26359 / 0 |
| POST /bookings latency p50 / p95 / p99 / max | 66.6 / 92.6 / 138.0 / 316.3 ms |
| Reserve attempts / retries | n/a (no retry loop) |
| Verifier: overlapping room bookings / pool over capacity | 0 / 0 — **invariants held** |
| Bookings in the table at the end (active) | 1106 (202) |
