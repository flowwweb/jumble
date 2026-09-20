import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutCents, createSponsorService, sponsorUrl } from '../functions/sponsors.mjs';

function fakeDb() {
  const records = new Map();
  let pending = Promise.resolve();
  const snapshot = path => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) });
  function read(ref) {
    if (typeof ref === 'string') return snapshot(ref);
    let rows = [...records].filter(([path]) => path.startsWith(`${ref.path}/`) && path.split('/').length === 2);
    if (ref.field) rows.sort((a, b) => (a[1][ref.field] - b[1][ref.field]) * (ref.direction === 'desc' ? -1 : 1));
    rows = rows.slice(0, ref.maximum);
    return { docs: rows.map(([path]) => snapshot(path)) };
  }
  function collection(path, field, direction, maximum = Infinity) {
    return { path, field, direction, maximum,
      orderBy: (next, order) => collection(path, next, order, maximum),
      limit: count => collection(path, field, direction, count),
      get: async () => read({ path, field, direction, maximum }),
    };
  }
  return { records, doc: path => path, collection,
    runTransaction(fn) {
      const operation = pending.then(async () => {
        const writes = new Map();
        const result = await fn({ get: async ref => read(ref), set: (ref, data) => writes.set(ref, structuredClone(data)) });
        for (const [ref, data] of writes) records.set(ref, data);
        return result;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
const uid = 'anonymous-player-one';
const input = (changes = {}) => ({ name: 'Example', url: 'https://example.com', amount: 100,
  submissionId: 'submission-one-12345', ...changes });
function fixture(gameMode) {
  const db = fakeDb();
  let time = Date.parse('2026-09-19T10:00:00Z');
  let next = 0;
  const sessions = new Map();
  const charges = new Map();
  const disputes = new Map();
  const calls = [];
  const stripe = {
    checkout: { sessions: { create: async (params, options) => {
      calls.push({ params, options });
      if (!sessions.has(options.idempotencyKey)) {
        const number = ++next;
        const session = { id: `cs_${number}`, url: `https://checkout.stripe.com/c/pay/${number}`, livemode: false, expires_at: params.expires_at };
        sessions.set(options.idempotencyKey, session);
        charges.set(`ch_${number}`, { id: `ch_${number}`, metadata: params.metadata, currency: 'usd', paid: true, captured: true,
          livemode: false, amount: params.line_items[0].price_data.unit_amount, amount_refunded: 0 });
      }
      return sessions.get(options.idempotencyKey);
    } } },
    charges: { retrieve: async id => structuredClone(charges.get(id)) },
    disputes: { retrieve: async id => structuredClone(disputes.get(id)) },
  };
  const service = createSponsorService({ db, stripe, origin: 'https://jumbbble.web.app', allowedReturnOrigins: ['https://jumbbble.web.app', 'https://jumble.flowwweb.com'], livemode: false, now: () => time,
    getPuzzle: day => { if (!['2026-09-18', '2026-09-19'].includes(day)) throw new Error('PUZZLE_NOT_AVAILABLE'); return { id: day, mode: gameMode }; } });
  const event = (id = 'ch_1', type = 'charge.succeeded') => ({ type, livemode: false, data: { object: { id } } });
  return { db, stripe, service, calls, charges, disputes, event, advance: ms => { time += ms; } };
}

test('SWAP checkout mode is validated, retained on both returns and cannot alter a retried intent', async () => {
  const {service,calls} = fixture('swap-adjacent-v1');
  const request = input({gameMode:'swap-adjacent-v1',puzzleId:'2026-09-18',returnTo:'result'});
  await service.checkout(uid,request);
  for (const field of ['success_url','cancel_url']) {
    const url = new URL(calls[0].params[field]);
    assert.equal(url.searchParams.get('mode'),'swap-adjacent-v1');
    assert.equal(url.searchParams.get('day'),'2026-09-18');
    assert.equal(url.searchParams.get('view'),'result');
  }
  for (const gameMode of [undefined,'shift-v1','https://evil.com']) await assert.rejects(service.checkout(uid,{...request,gameMode}));
  assert.equal(calls.length,1);
  assert.equal((await service.list()).total,0);
});

test('exact join/takeover economics, cumulative credit, whole dollars and cap', () => {
  assert.equal(checkoutCents('join', 10000, 0), 100);
  assert.equal(checkoutCents('takeover', 550, 100), 600);
  assert.equal(checkoutCents('takeover', 500, 500), 100);
  assert.equal(checkoutCents('join', 0, 0, 1_000_000), 1_000_000);
  for (const amount of [-100, 0, 1, 100.5, 150, Infinity, NaN, '100', 1_000_100]) assert.throws(() => checkoutCents('join', 0, 0, amount));
  assert.throws(() => checkoutCents('takeover', 1000, 0, 100));
  assert.throws(() => checkoutCents('other', 0, 0));
});
test('URLs are public HTTPS only and normalize aliases/fragments', () => {
  assert.equal(sponsorUrl('Example.COM/#a'), 'https://example.com/');
  assert.equal(sponsorUrl('@example'), 'https://x.com/example');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://user:password@example.com', 'https://example.com:8080', 'https://foo.internal', {}, '']) assert.throws(() => sponsorUrl(url));
});
test('empty board has no seeds; checkout redirects grant no credit and metadata binds project', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(await service.list(), { rows: [], total: 0, totalCents: 0, topCents: 0 });
  await service.checkout(uid, input());
  assert.equal((await service.list()).totalCents, 0);
  const params = calls[0].params;
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.branding_settings, { display_name: 'Jumble' });
  assert.equal(params.metadata.project, 'jumble');
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata);
  assert.equal(params.payment_method_types, undefined);
  assert.match(params.integration_identifier, /^jumble-sponsor-[a-z]{8}$/);
  assert.equal(params.success_url, 'https://jumbbble.web.app/?sponsor=thanks');
});
test('malicious payloads fail before provider work and stable IDs reject edited intent', async () => {
  const { service, calls } = fixture();
  for (const changes of [{ name: '<script>' }, { name: '\nabc' }, { name: '' }, { name: 'a'.repeat(61) },
    { submissionId: '../../secret' }, { amount: '100' }, { amount: 150 }, { url: 'https://foo.local' }]) {
    await assert.rejects(service.checkout(uid, input(changes)));
  }
  await assert.rejects(service.checkout('short', input()), { code: 'AUTH_REQUIRED' });
  assert.equal(calls.length, 0);
  const first = await service.checkout(uid, input());
  assert.deepEqual(await service.checkout(uid, input()), first);
  assert.equal(calls.length, 1);
  await assert.rejects(service.checkout(uid, input({ amount: 200 })), { code: 'SUBMISSION_CONFLICT' });
});
test('concurrent checkout and webhook retries reuse a single provider session and credit', async () => {
  const { service, calls, event } = fixture();
  const [first, second] = await Promise.all([service.checkout(uid, input()), service.checkout(uid, input())]);
  assert.deepEqual(first, second);
  assert.equal(new Set(calls.map(call => call.options.idempotencyKey)).size, 1);
  await Promise.all([service.handleEvent(event()), service.handleEvent(event())]);
  assert.equal((await service.list()).totalCents, 100);
  const row = (await service.list()).rows[0];
  assert.deepEqual(row, { name: 'Example', url: 'https://example.com/', cents: 100 });
});
test('fresh charge state defeats stale refund snapshots; recorded refunds cannot resurrect', async () => {
  const { service, event, charges } = fixture();
  await service.checkout(uid, input({ amount: 500 }));
  charges.get('ch_1').amount_refunded = 175;
  await service.handleEvent(event());
  assert.equal((await service.list()).totalCents, 325);
  charges.get('ch_1').amount_refunded = 0;
  await service.handleEvent(event());
  assert.equal((await service.list()).totalCents, 325);
  charges.get('ch_1').amount_refunded = 500;
  await service.handleEvent(event('ch_1', 'charge.refunded'));
  assert.equal((await service.list()).total, 0);
  assert.equal((await service.list()).totalCents, 0);
});
test('lost disputes remove credit once; won/open disputes and later charge events do not restore losses', async () => {
  const { service, event, disputes } = fixture();
  await service.checkout(uid, input());
  await service.handleEvent(event());
  disputes.set('dp_1', { status: 'won', charge: 'ch_1' });
  await service.handleEvent(event('dp_1', 'charge.dispute.closed'));
  assert.equal((await service.list()).totalCents, 100);
  disputes.set('dp_1', { status: 'lost', charge: 'ch_1' });
  await service.handleEvent(event('dp_1', 'charge.dispute.closed'));
  await service.handleEvent(event('dp_1', 'charge.dispute.closed'));
  await service.handleEvent(event());
  assert.equal((await service.list()).totalCents, 0);
});
test('wrong project/currency/mode/unpaid/uncaptured charge never publishes', async () => {
  for (const patch of [{ metadata: { project: 'whackareset', kind: 'sponsor' } }, { currency: 'eur' }, { livemode: true },
    { paid: false }, { captured: false }, { metadata: { project: 'jumble', kind: 'other' } }]) {
    const { service, event, charges } = fixture();
    await service.checkout(uid, input());
    Object.assign(charges.get('ch_1'), patch);
    assert.equal((await service.handleEvent(event())).ignored, true);
    assert.equal((await service.list()).totalCents, 0);
  }
});
test('amount mismatch, over-refund and unsafe metadata references fail closed', async () => {
  for (const patch of [{ amount: 200 }, { amount_refunded: 101 }, { amount_captured: 50 }, { metadata: { project: 'jumble', kind: 'sponsor', sponsorId: '../x' } }]) {
    const { service, event, charges } = fixture();
    await service.checkout(uid, input());
    Object.assign(charges.get('ch_1'), patch);
    await assert.rejects(service.handleEvent(event()));
    assert.equal((await service.list()).totalCents, 0);
  }
});
test('cumulative URL credit reduces takeover price and new payer cannot overwrite listing name', async () => {
  const { service, event } = fixture();
  await service.checkout(uid, input({ amount: 500 }));
  await service.handleEvent(event());
  await service.checkout(uid, input({ submissionId: 'second-submission-123', url: 'https://other.com', amount: 1000 }));
  await service.handleEvent(event('ch_2'));
  const next = await service.checkout('different-anonymous-player', input({ submissionId: 'third-submission-123', name: 'Impersonation', mode: 'takeover', amount: undefined }));
  assert.equal(next.cents, 600);
  await service.handleEvent(event('ch_3'));
  assert.deepEqual((await service.list()).rows[0], { name: 'Example', url: 'https://example.com/', cents: 1100 });
});
test('hidden listings stay hidden after later payments and retain economic balance', async () => {
  const { service, event, db } = fixture();
  await service.checkout(uid, input());
  await service.handleEvent(event());
  const listing = [...db.records.keys()].find(path => path.startsWith('sponsorsTest/'));
  db.records.get(listing).hidden = true;
  await service.checkout(uid, input({ submissionId: 'second-submission-123' }));
  await service.handleEvent(event('ch_2'));
  const board = await service.list();
  assert.equal(board.rows.length, 0);
  assert.equal(board.totalCents, 200);
  assert.equal(board.topCents, 200);
});
test('expired requests cannot create another checkout after Stripe idempotency retention', async () => {
  const { service, advance, calls } = fixture();
  await service.checkout(uid, input());
  advance(24 * 60 * 60 * 1000);
  await assert.rejects(service.checkout(uid, input()), { code: 'CHECKOUT_EXPIRED' });
  assert.equal(calls.length, 1);
});

test('historical result context survives success/cancel with pinned origin and stable retry', async () => {
  const { service, calls } = fixture();
  const request = input({ puzzleId: '2026-09-18', returnTo: 'result', returnUrl: 'https://evil.com' });
  const first = await service.checkout(uid, request);
  assert.deepEqual(await service.checkout(uid, request), first);
  for (const [field, status] of [['success_url', 'thanks'], ['cancel_url', 'cancelled']]) {
    const url = new URL(calls[0].params[field]);
    assert.equal(url.origin, 'https://jumbbble.web.app');
    assert.equal(url.pathname, '/');
    assert.equal(url.searchParams.get('sponsor'), status);
    assert.equal(url.searchParams.get('day'), '2026-09-18');
    assert.equal(url.searchParams.get('view'), 'result');
  }
  await assert.rejects(service.checkout(uid, { ...request, puzzleId: '2026-09-19' }), { code: 'SUBMISSION_CONFLICT' });
  assert.equal(calls.length, 1);
});
test('checkout rejects malformed, future, unpublished and open-redirect return contexts before provider work', async () => {
  const { service, calls } = fixture();
  for (const changes of [{ puzzleId: '2026-09-20' }, { puzzleId: '2026-02-30' }, { puzzleId: '2026-01-01' },
    { puzzleId: '//evil.com' }, { puzzleId: '2026-09-18', returnTo: 'https://evil.com' }, { returnTo: 'result' }]) {
    await assert.rejects(service.checkout(uid, input(changes)));
  }
  assert.equal(calls.length, 0);
});

test('both requested domains preserve historical checkout return context', async () => {
  for (const origin of ['https://jumbbble.web.app', 'https://jumble.flowwweb.com']) {
    const { service, calls } = fixture();
    await service.checkout(uid, input({ puzzleId: '2026-09-18', returnTo: 'result', returnOrigin: 'https://evil.com' }), origin);
    for (const field of ['success_url', 'cancel_url']) {
      const returned = new URL(calls[0].params[field]);
      assert.equal(returned.origin, origin);
      assert.equal(returned.searchParams.get('day'), '2026-09-18');
      assert.equal(returned.searchParams.get('view'), 'result');
    }
  }
});
test('unapproved request origins fail before storage/provider work', async () => {
  const { service, calls, db } = fixture();
  for (const origin of ['https://evil.com', 'https://playjumble.web.app', 'https://jumble.flowwweb.com.evil.com',
    'http://jumble.flowwweb.com', 'https://jumble.flowwweb.com/path', 'https://user@jumble.flowwweb.com', 'null']) {
    await assert.rejects(service.checkout(uid, input(), origin), { code: 'INVALID_RETURN_ORIGIN' });
  }
  assert.equal(calls.length, 0);
  assert.equal(db.records.size, 0);
});
test('uncertain provider response retries retain initiating origin and original idempotency parameters', async () => {
  const { service, stripe, calls } = fixture();
  const create = stripe.checkout.sessions.create;
  let first = true;
  stripe.checkout.sessions.create = async (...args) => {
    const session = await create(...args);
    if (first) { first = false; throw new Error('Simulated connection loss after provider creation'); }
    return session;
  };
  const request = input({ puzzleId: '2026-09-18', returnTo: 'result' });
  await assert.rejects(service.checkout(uid, request, 'https://jumble.flowwweb.com'));
  await service.checkout(uid, request, 'https://jumbbble.web.app');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(new URL(calls[1].params.success_url).origin, 'https://jumble.flowwweb.com');
});
