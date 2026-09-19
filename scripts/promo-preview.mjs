// Isolated promo only: serves an existing build, never imports or contacts production services.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO = Object.freeze({ id: '2099-01-01', letters: [...'OTSHOERULDTOERS'], dictionaryVersion: 'promo-isolated-v1' });
const words = ['outdoors', 'shelter'];
const signature = value => [...value].sort().join('');

export function createPromoServer(dist = fileURLToPath(new URL('../dist/', import.meta.url))) {
  let started = 0;
  return createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Loopback demo only.' });
      if (url.pathname === '/api/puzzle' && req.method === 'GET') return json(200, DEMO);
      if (url.pathname === `/data/words-${DEMO.dictionaryVersion}.json` && req.method === 'GET') return json(200, { version: DEMO.dictionaryVersion, words });
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/sponsors' && req.method === 'GET') return json(200, { rows: [], topCents: 0 });
        if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(413, { error: 'Request too large.' }); }
        const input = body ? JSON.parse(body) : {};
        if (url.pathname === '/api/event' || url.pathname === '/api/report') return json(200, { demo: true });
        if (url.pathname === '/api/checkout') return json(403, { error: 'Payments are disabled in this isolated demo.' });
        if (input.puzzleId !== DEMO.id) return json(400, { error: 'Demo puzzle only.' });
        if (url.pathname === '/api/session') { started ||= Date.now(); return json(200, { sessionId: 'promo-memory-only' }); }
        if (url.pathname === '/api/result') {
          if (!started || input.sessionId !== 'promo-memory-only' || input.dictionaryVersion !== DEMO.dictionaryVersion || !Array.isArray(input.words)
            || input.words.length !== 2 || !input.words.every(word => words.includes(word))
            || signature(input.words.join('')) !== signature(DEMO.letters.join('').toLowerCase())) return json(400, { error: 'Invalid demo solve.' });
          return json(200, { puzzleId: DEMO.id, words: input.words, wordCount: 2, minimum: 2, elapsedMs: Date.now() - started, rank: 1, total: 1, tied: 1, rankingAsOf: Date.now(), demo: true });
        }
        return json(404, { error: 'No demo endpoint.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed.' });
      const root = await realpath(dist);
      const path = await realpath(resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`));
      const within = relative(root, path);
      if (within.startsWith('..') || isAbsolute(within)) return json(403, { error: 'Outside preview build.' });
      let data = await readFile(path);
      if (path === resolve(root, 'index.html')) data = Buffer.from(data.toString().replace('</head>', '<style>#day::before{content:"Demo puzzle · "}#rank::before{content:"Sample result · "}</style></head>'));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) { json(error instanceof SyntaxError ? 400 : 404, { error: 'Demo request unavailable.' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPromoServer();
  server.listen(4179, '127.0.0.1', () => console.log('ISOLATED PROMO: http://127.0.0.1:4179/?day=2099-01-01 | OUTDOORS + SHELTER | no production writes'));
}
