// The race: every virtual user keeps trying to book one of a few seats for one of a few slots,
// with a fresh Idempotency-Key each time, and gives most of them back so the contention never
// dies down. Same script for every strategy; the verifier judges the database afterwards.

import { check } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3100';
const VUS = Number(__ENV.BENCH_VUS || 100);
const DURATION = __ENV.BENCH_DURATION || '20s';
const RELEASE_RATIO = Number(__ENV.BENCH_RELEASE_RATIO || 0.8);

export const options = {
  scenarios: {
    race: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '5s' },
  },
  thresholds: {},
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

const created = new Counter('bookings_created');
const conflicts = new Counter('bookings_conflict');
const failures = new Counter('bookings_failed');
const reserveLatency = new Trend('reserve_latency', true);

const ROOMS = ['room-1', 'room-2', 'room-3', 'room-4', 'room-5'];
const POOL = 'pool-hot-desks';
const SLOTS = Array.from({ length: 20 }, (_, i) => {
  const start = new Date(Date.UTC(2026, 9, 1, 8) + i * 30 * 60 * 1000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
  };
});

export default function () {
  const resourceId = Math.random() < 0.1 ? POOL : ROOMS[Math.floor(Math.random() * ROOMS.length)];
  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
  const userId = `vu-${__VU}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
    'Idempotency-Key': `${__VU}-${__ITER}-${Date.now()}`,
  };
  const res = http.post(`${BASE}/bookings`, JSON.stringify({ resourceId, ...slot }), {
    headers,
    tags: { name: 'POST /bookings' },
  });
  reserveLatency.add(res.timings.duration);
  if (res.status === 201) {
    created.add(1);
    if (Math.random() < RELEASE_RATIO) {
      const id = res.json('id');
      const del = http.del(`${BASE}/bookings/${id}`, null, {
        headers: { 'X-User-Id': userId },
        tags: { name: 'DELETE /bookings/:id' },
      });
      check(del, { 'cancel ok': (r) => r.status === 200 });
    }
  } else if (res.status === 409) {
    conflicts.add(1);
  } else {
    failures.add(1);
  }
  check(res, { 'no 5xx': (r) => r.status < 500 });
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, key) => m[name]?.values?.[key];
  const line = [
    `requests=${v('http_reqs', 'count')}`,
    `rps=${(v('http_reqs', 'rate') || 0).toFixed(1)}`,
    `created=${v('bookings_created', 'count') || 0}`,
    `conflict=${v('bookings_conflict', 'count') || 0}`,
    `failed=${v('bookings_failed', 'count') || 0}`,
    `p50=${(v('reserve_latency', 'med') || 0).toFixed(1)}ms`,
    `p95=${(v('reserve_latency', 'p(95)') || 0).toFixed(1)}ms`,
    `p99=${(v('reserve_latency', 'p(99)') || 0).toFixed(1)}ms`,
  ].join(' ');
  const out = { stdout: `${line}\n` };
  if (__ENV.SUMMARY_PATH) out[__ENV.SUMMARY_PATH] = JSON.stringify(data);
  return out;
}
