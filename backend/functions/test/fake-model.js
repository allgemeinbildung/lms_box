// Local stand-in for the formativ service. No model, no network beyond 127.0.0.1.
//
//   node test/fake-model.js [port]        default 5139 = FORMATIV_URL in ../.env.local
//
// POST /v1/bewerten  → one criterion per rubric entry, always "teilweise"
// GET  /_calls       → every request received so far: [{ headers, body }]
const http = require('node:http');

function startFakeModel({ port = 5139, delayMs = 0 } = {}) {
    const calls = [];
    const server = http.createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (req.method === 'GET' && req.url === '/_calls') { res.end(JSON.stringify(calls)); return; }
        if (req.method !== 'POST' || req.url !== '/v1/bewerten') { res.statusCode = 404; res.end('{}'); return; }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        calls.push({ headers: req.headers, body });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const rubrik = body.rubrik || [{ id: 'k1', label: 'Standard' }];
        res.end(JSON.stringify({
            zustand: 'vollstaendig',
            kriterien: rubrik.map((k) => ({
                id: k.id, label: k.label, status: 'teilweise', hinweis: `Simulierter Hinweis zu «${k.label}».`, beleg: null, grund: null,
            })),
            meta: { request_id: `fake-${calls.length}`, prompt_version: 'fake-v1' },
        }));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({
            calls, port, url: `http://127.0.0.1:${port}`,
            close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
        }));
    });
}

module.exports = { startFakeModel };

if (require.main === module) {
    startFakeModel({ port: Number(process.argv[2] || 5139) }).then((m) => console.log(`fake formativ on ${m.url}`));
}
