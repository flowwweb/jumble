import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromoServer, DEMO } from './promo-preview.mjs';

test('isolated promo exposes only the demo and validates its exact solve', async () => {
  assert.equal(DEMO.letters.length, 15);
  assert.equal([...DEMO.letters.join('').toLowerCase()].sort().join(''), [...'outdoorsshelter'].sort().join(''));
  const server = createPromoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Demo puzzle/); assert.match(html, /Sample result/);
    assert.deepEqual(await (await fetch(`${base}/api/puzzle?day=2026-09-19`)).json(), DEMO);
    assert.deepEqual((await (await fetch(`${base}/data/words-${DEMO.dictionaryVersion}.json`)).json()).words, ['outdoors', 'shelter']);
    const { sessionId } = await (await post('session', { puzzleId: DEMO.id })).json();
    const body = { puzzleId: DEMO.id, sessionId, dictionaryVersion: DEMO.dictionaryVersion, words: ['outdoors', 'shelter'] };
    const result = await (await post('result', body)).json();
    assert.equal(result.minimum, 2); assert.equal(result.demo, true); assert.deepEqual(result.words, body.words);
    assert.equal((await post('result', { ...body, words: ['outdoors', 'outdoors'] })).status, 400);
    assert.equal((await post('result', { ...body, puzzleId: '2026-09-19' })).status, 400);
    assert.equal((await post('checkout', {})).status, 403);
    assert.equal((await fetch(`${base}/api/puzzle`, { headers: { Origin: 'https://jumble.flowwweb.com' } })).status, 403);
    assert.equal((await fetch(`${base}/scripts/promo-preview.mjs`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
