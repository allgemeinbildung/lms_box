// Local stand-in for Gemini generateContent. No model, no network beyond 127.0.0.1.
//
//   node test/fake-gemini.js [port]        default 5149
//
// POST /<model>:generateContent → an analysis built from the pseudonyms in the request:
//   one pattern with the first two learners, a verbatim quote of L01, an invented quote,
//   an unknown pseudonym L99, and a pseudonym in free text — so that every check of
//   klassenanalyse.ergebnisPruefen has something to drop or to keep.
// GET  /_calls → every request received so far: [{ url, headers, body }]
const http = require('node:http');

/** The analysis the fake returns for one request body (also used directly by the tests). */
function fakeAnalyse(body) {
    const user = body?.contents?.[0]?.parts?.[0]?.text || '';
    const eingabe = JSON.parse(user.slice(user.indexOf('{')));
    const ps = eingabe.lernende.map((l) => l.pseudonym);
    const f = eingabe.fragen[0];
    const k = f.rubrik[0]?.id || 'k1';
    const erste = eingabe.lernende[0]?.antworten[0]?.antwort || '';
    return {
        lage: `Die meisten haben die Karte abgeschlossen; ${ps[0]} zeigt das typische Muster.`,
        muster: [{
            titel: 'Teil und Ganzes verwechselt',
            beschreibung: 'Mehrere Antworten setzen das Interesse einer Gruppe mit dem Interesse aller gleich.',
            kriterien: [`${f.id}/${k}`, `${f.id}/k99`],
            fragen: [f.id, 'Q-ERFUNDEN'],
            lernende: [ps[0], ps[1], 'L99'],
            belege: [
                { lernende: ps[0], zitat: erste.slice(0, 40) },
                { lernende: ps[1], zitat: 'Das hat niemand so geschrieben.' },
                { lernende: 'L99', zitat: erste.slice(0, 20) },
            ],
            plenum_impuls: 'Für wen spricht die Gruppe im Beitrag?',
        }],
        gruppen: [{ ziel: 'Wer spricht für wen?', lernende: [ps[0], ps[2], 'L77'], auftrag: 'Zu zweit drei Beispiele sammeln.' }],
        einzelne: [
            { lernende: ps[1], beobachtung: 'Antwortet am Thema vorbei.', naechster_schritt: 'Die Frage nochmals lesen.' },
            { lernende: 'L99', beobachtung: 'gibt es nicht', naechster_schritt: '-' },
        ],
        rueckmeldung_check: [
            { lernende: ps[0], frage: f.id, kriterium: k, problem: 'zu_mild', begruendung: 'Erfüllt, obwohl die Gegenposition fehlt.' },
            { lernende: ps[0], frage: f.id, kriterium: k, problem: 'ganz_falsch', begruendung: 'unbekanntes Problem' },
        ],
        gelungen: [{ beschreibung: 'Die Begriffe werden sauber verwendet.', lernende: [ps[2]] }],
    };
}

function geminiAntwort(body, { modelVersion = 'gemini-fake-001' } = {}) {
    return {
        candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(fakeAnalyse(body)) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 567, thoughtsTokenCount: 89, totalTokenCount: 1890 },
        modelVersion,
        responseId: 'fake-response',
    };
}

function startFakeGemini({ port = 5149, delayMs = 0 } = {}) {
    const calls = [];
    const server = http.createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (req.method === 'GET' && req.url === '/_calls') { res.end(JSON.stringify(calls)); return; }
        if (req.method !== 'POST' || !req.url.endsWith(':generateContent')) { res.statusCode = 404; res.end('{}'); return; }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        calls.push({ url: req.url, headers: req.headers, body });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        res.end(JSON.stringify(geminiAntwort(body)));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({
            calls, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
        }));
    });
}

module.exports = { startFakeGemini, fakeAnalyse, geminiAntwort };

if (require.main === module) {
    startFakeGemini({ port: Number(process.argv[2] || 5149) }).then((m) => console.log(`fake gemini on ${m.url}`));
}
