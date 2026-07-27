/**
 * Taller — optional AI answer service (Cloudflare Worker).
 *
 * The app sends { question, lang, excerpts:[{manual, page, text}] } and this
 * worker asks Claude for an answer grounded ONLY in those excerpts, with page
 * citations. Nothing is stored. If this worker is not deployed, the app still
 * works fully offline (search + exact excerpts + copy-prompt).
 *
 * ── Deploy (dashboard only, ~15 min, no command line) ────────────────────────
 * 1. Create a free Cloudflare account → dash.cloudflare.com
 * 2. Workers & Pages → Create → Create Worker → name it (e.g. "taller-ai") → Deploy
 * 3. "Edit code" → delete the sample → paste THIS ENTIRE FILE → Deploy
 * 4. Worker → Settings → Variables and Secrets → Add:
 *      Type: Secret · Name: ANTHROPIC_API_KEY · Value: your key (console.anthropic.com)
 * 5. (Optional but recommended, enables per-IP daily limits)
 *    Storage & Databases → KV → Create namespace "taller-rl", then
 *    Worker → Settings → Bindings → Add → KV namespace →
 *      Variable name: RATE_KV · Namespace: taller-rl
 * 6. Copy the worker URL (https://taller-ai.<you>.workers.dev) into js/config.js
 *    → aiEndpoint, commit, done.
 *
 * Cost guard: with Haiku pricing (2026: $1/M input, $5/M output tokens) a
 * typical question costs ~$0.006. The free-tier KV write limit (~1,000/day)
 * naturally caps spend at a few $/day worst case; per-IP limit is 25/day.
 */

const MODEL = 'claude-haiku-4-5';            // cheap + good enough for grounded Q&A
const MAX_TOKENS = 700;
const PER_IP_PER_DAY = 25;
const GLOBAL_PER_DAY = 800;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET') {
      return json({ ok: true, service: 'taller-ai', model: MODEL });
    }
    if (request.method !== 'POST' || !url.pathname.endsWith('/ask')) {
      return json({ error: 'not found' }, 404);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'server not configured' }, 500);

    // ---- rate limiting (best-effort; KV binding optional) ----
    if (env.RATE_KV) {
      try {
        const day = new Date().toISOString().slice(0, 10);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const ipKey = `rl:${day}:${ip}`;
        const gKey = `rl:${day}:GLOBAL`;
        const [ipN, gN] = await Promise.all([env.RATE_KV.get(ipKey), env.RATE_KV.get(gKey)]);
        if (parseInt(ipN || '0', 10) >= PER_IP_PER_DAY) return json({ error: 'daily limit reached — try tomorrow' }, 429);
        if (parseInt(gN || '0', 10) >= GLOBAL_PER_DAY) return json({ error: 'service busy today — try tomorrow' }, 429);
        await Promise.all([
          env.RATE_KV.put(ipKey, String(parseInt(ipN || '0', 10) + 1), { expirationTtl: 172800 }),
          env.RATE_KV.put(gKey, String(parseInt(gN || '0', 10) + 1), { expirationTtl: 172800 }),
        ]);
      } catch (e) { /* rate limit is best-effort */ }
    }

    // ---- validate input ----
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const question = String(body.question || '').slice(0, 1000).trim();
    let excerpts = Array.isArray(body.excerpts) ? body.excerpts.slice(0, 8) : [];
    excerpts = excerpts.map(x => ({
      manual: String(x.manual || '?').slice(0, 120),
      page: parseInt(x.page, 10) || 0,
      text: String(x.text || '').slice(0, 4000),
    })).filter(x => x.text.length > 20);
    if (!question || !excerpts.length) return json({ error: 'question and excerpts required' }, 400);

    const totalChars = excerpts.reduce((s, x) => s + x.text.length, 0);
    if (totalChars > 26000) return json({ error: 'excerpts too large' }, 400);

    // ---- build prompt ----
    const system = [
      'You assist professional biomedical equipment technicians in low-resource hospitals.',
      'Answer ONLY from the service-manual excerpts provided by the user. They are the sole source of truth.',
      'Cite the source for every instruction, inline, like: (Manual name, p. 12).',
      'If the excerpts do not contain enough information to answer safely, say exactly that and suggest what to look for in the manual — never invent procedures, values or part numbers.',
      'Include specific safety warnings when the work involves mains power, capacitors, pressure, oxygen or biohazards. Never suggest bypassing interlocks, alarms or protective devices.',
      'Answer in the same language as the question. Be concise: numbered steps first, then brief notes.',
      'End with this reminder in the question\'s language: "Verify on the cited page before acting."',
    ].join('\n');

    const excerptBlock = excerpts.map((x, i) =>
      `[${i + 1}] "${x.manual}" — page ${x.page}:\n${x.text}`).join('\n\n');
    const userMsg = `QUESTION: ${question}\n\nMANUAL EXCERPTS:\n${excerptBlock}`;

    // ---- call Anthropic ----
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.MODEL || MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.log('anthropic error', res.status, errText.slice(0, 300));
        return json({ error: 'ai upstream error' }, 502);
      }
      const data = await res.json();
      const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (!answer) return json({ error: 'empty answer' }, 502);
      return json({ answer });
    } catch (e) {
      return json({ error: 'ai unreachable' }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
