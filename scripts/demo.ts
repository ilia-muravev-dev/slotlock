// `just demo` — the whole story against a running API (default http://localhost:3000):
// a hold, an idempotent retry, a competing booking, a payment delivered as shuffled and
// duplicated webhooks, a reused key with a different body, a cancellation, and — if the hold TTL
// is short enough to wait for — an expiry by the worker.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// a random future day, so repeated demos against the same database do not collide
const day = new Date(Date.now() + (1 + Math.floor(Math.random() * 300)) * 86_400_000);
const at = (hour: number) =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour)).toISOString();
const SLOT = { startsAt: at(9), endsAt: at(10) };

interface Reply {
  status: number;
  replayed: boolean;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; user?: string; key?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.user) headers['x-user-id'] = options.user;
  if (options.key) headers['idempotency-key'] = options.key;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return {
    status: response.status,
    replayed: response.headers.get('idempotency-replayed') === 'true',
    body,
  };
}

function step(title: string): void {
  console.log(`\n▶ ${title}`);
}

function show(reply: Reply, ...fields: string[]): void {
  const picked = fields.length
    ? Object.fromEntries(fields.map((f) => [f, reply.body[f]]))
    : reply.body;
  console.log(`  ${reply.status}${reply.replayed ? ' (replayed)' : ''} ${JSON.stringify(picked)}`);
}

async function main(): Promise<void> {
  const health = await call('GET', '/health');
  console.log(`slotlock at ${BASE} — strategy ${String(health.body.strategy)}`);
  const run = Date.now().toString(36);
  const alice = `alice-${run}`;
  const bob = `bob-${run}`;

  step(`Alice holds room-1 for ${SLOT.startsAt.slice(0, 10)} 09:00–10:00 (Idempotency-Key k1)`);
  const held = await call('POST', '/bookings', {
    body: { resourceId: 'room-1', ...SLOT },
    user: alice,
    key: `k1-${run}`,
  });
  show(held, 'id', 'status', 'amountCents', 'holdExpiresAt');
  if (held.status !== 201)
    throw new Error(
      `expected 201, the slot may be taken from an earlier run: ${JSON.stringify(held.body)}`,
    );
  const bookingId = String(held.body.id);
  const payment = held.body.payment as { id: string; provider: string };
  console.log(`  payment intent ${payment.id} (${payment.provider})`);

  step(
    'Her client times out and retries with the same key: the stored answer comes back, no second hold',
  );
  show(
    await call('POST', '/bookings', {
      body: { resourceId: 'room-1', ...SLOT },
      user: alice,
      key: `k1-${run}`,
    }),
    'id',
    'status',
  );

  step('Bob wants the same room and slot');
  show(
    await call('POST', '/bookings', {
      body: { resourceId: 'room-1', ...SLOT },
      user: bob,
      key: `k2-${run}`,
    }),
    'code',
    'message',
  );

  step("Alice reuses k1 for a different request: that's a 422, not a silent replay");
  show(
    await call('POST', '/bookings', {
      body: { resourceId: 'room-2', ...SLOT },
      user: alice,
      key: `k1-${run}`,
    }),
    'code',
  );

  step(
    'The customer pays; the PSP delivers created/processing/succeeded shuffled, and succeeded twice',
  );
  const paid = await call('POST', `/fake-psp/payments/${payment.id}/pay`, {
    body: { order: 'shuffled', duplicate: true },
  });
  if (paid.status === 404) {
    console.log(
      '  (Stripe is the configured provider; pay the intent with a real test card instead)',
    );
  } else {
    for (const d of paid.body.delivered as {
      type: string;
      createdAt: string;
      outcome: string;
      status?: string;
    }[]) {
      console.log(
        `  ${d.createdAt}  ${d.type.padEnd(28)} → ${d.outcome}${d.status ? ` (${d.status})` : ''}`,
      );
    }
  }
  show(await call('GET', `/bookings/${bookingId}`), 'id', 'status', 'holdExpiresAt');

  step('Bob books room-2 instead, then changes his mind');
  const bobs = await call('POST', '/bookings', {
    body: { resourceId: 'room-2', ...SLOT },
    user: bob,
    key: `k3-${run}`,
  });
  show(bobs, 'id', 'status');
  show(await call('DELETE', `/bookings/${bobs.body.id}`, { user: bob }), 'id', 'status');
  show(await call('DELETE', `/bookings/${bobs.body.id}`, { user: alice }), 'code');

  step('Carol holds room-3 and never pays');
  const carols = await call('POST', '/bookings', {
    body: { resourceId: 'room-3', ...SLOT },
    user: `carol-${run}`,
    key: `k4-${run}`,
  });
  show(carols, 'id', 'status', 'holdExpiresAt');
  const ttlMs = new Date(String(carols.body.holdExpiresAt)).getTime() - Date.now();
  if (ttlMs > 90_000) {
    console.log(
      `  the hold lasts ${Math.round(ttlMs / 1000)} s — run the stack with HOLD_TTL_SECONDS=20 to watch it expire here`,
    );
  } else {
    process.stdout.write(`  waiting ${Math.ceil(ttlMs / 1000)} s for the worker to expire it`);
    const deadline = Date.now() + ttlMs + 30_000;
    let status = 'HELD';
    while (status === 'HELD' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      process.stdout.write('.');
      status = String((await call('GET', `/bookings/${carols.body.id}`)).body.status);
    }
    console.log();
    show(await call('GET', `/bookings/${carols.body.id}`), 'id', 'status');
    step('Room-3 is free again');
    show(
      await call('POST', '/bookings', {
        body: { resourceId: 'room-3', ...SLOT },
        user: bob,
        key: `k5-${run}`,
      }),
      'id',
      'status',
    );
  }

  console.log(
    '\nEvery step above also left an outbox row; the worker logs each as a notification, exactly once.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
