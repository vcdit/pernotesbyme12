// Pernotes engine: satu function untuk UI + API. Storage: Upstash Redis (REST, tanpa package).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const API_KEY = process.env.API_KEY || '17022013';
const HASH = 'pernotes';
const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange'];

async function redis(...cmd) {
  if (!DB_URL || !DB_TOKEN) throw new Error('Database belum terhubung (Upstash Redis)');
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const all = async () => ((await redis('HVALS', HASH)) || []).map((s) => JSON.parse(s));
const get = async (id) => {
  const s = await redis('HGET', HASH, id);
  return s ? JSON.parse(s) : null;
};
const save = (n) => redis('HSET', HASH, n.id, JSON.stringify(n));

function build(b, base) {
  const n = { ...base };
  if ('title' in b) n.title = String(b.title).trim().slice(0, 200);
  if ('content' in b) n.content = String(b.content).trim().slice(0, 20000);
  if ('tags' in b) {
    const t = Array.isArray(b.tags) ? b.tags : String(b.tags).split(',');
    n.tags = [...new Set(t.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  }
  if ('color' in b) n.color = COLORS.includes(b.color) ? b.color : 'yellow';
  if ('pinned' in b) n.pinned = b.pinned === true || b.pinned === 'true';
  if ('trashed' in b) n.trashed = b.trashed === true || b.trashed === 'true';
  return n;
}
const sortNotes = (a) => a.sort((x, y) => (y.pinned - x.pinned) || (y.updated - x.updated));
const text = (n) => [n.title, n.content, (n.tags || []).join(' ')].join(' ').toLowerCase();

function page() {
  for (const p of [path.join(process.cwd(), 'views', 'index.html'), path.join(__dirname, '..', 'views', 'index.html')]) {
    try { return fs.readFileSync(p, 'utf8'); } catch (e) {}
  }
  return '<h1>views/index.html tidak ditemukan</h1>';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const u = new URL(req.url, 'http://x');
  const q = Object.fromEntries(u.searchParams);
  const p = u.pathname;
  const route = q.r || (p.startsWith('/search') ? 'search' : p.startsWith('/n/') ? 'note' : 'root');
  const out = (c, o) => res.status(c).json(o);

  // Browser biasa (Accept: text/html) di "/" = tampilan UI. Selain itu = JSON.
  if (req.method === 'GET' && route === 'root' && (req.headers.accept || '').includes('text/html') && q.format !== 'json') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page());
  }

  const given = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || q.key;
  if (given !== API_KEY) return out(401, { ok: false, error: 'API key salah / tidak ada (header x-api-key)' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  try {
    const now = Date.now();
    const id = q.id || (route === 'note' ? p.split('/')[2] : undefined) || b.id;

    // ---- SEARCH: /search?q=kata&tag=x  atau  /search?id=abc
    if (route === 'search') {
      if (q.id) { const n = await get(q.id); return n ? out(200, { ok: true, count: 1, notes: [n] }) : out(404, { ok: false, error: 'Note tidak ditemukan' }); }
      let ns = (await all()).filter((n) => !n.trashed);
      if (q.q) { const s = q.q.toLowerCase(); ns = ns.filter((n) => text(n).includes(s)); }
      if (q.tag) ns = ns.filter((n) => (n.tags || []).includes(q.tag.toLowerCase()));
      sortNotes(ns);
      return out(200, { ok: true, count: ns.length, notes: ns });
    }

    // ---- /n/:id  (atau / dengan ?id= / body.id)
    if (id && ['GET', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const old = await get(id);
      if (!old) return out(404, { ok: false, error: 'Note tidak ditemukan' });
      if (req.method === 'GET') return out(200, { ok: true, note: old });
      if (req.method === 'DELETE') {
        if (q.permanent === '1') { await redis('HDEL', HASH, id); return out(200, { ok: true, deleted: id, permanent: true }); }
        const n = { ...old, trashed: true, updated: now };
        await save(n);
        return out(200, { ok: true, trashed: id, note: n });
      }
      if (req.method === 'PUT') {
        if (!b.title || !b.content) return out(400, { ok: false, error: 'PUT wajib title dan content' });
        const n = build(b, { id, created: old.created, tags: [], color: 'yellow', pinned: false, trashed: false });
        n.updated = now; await save(n);
        return out(200, { ok: true, note: n });
      }
      const n = build(b, old); n.updated = now; // PATCH
      if (!n.title || !n.content) return out(400, { ok: false, error: 'title dan content tidak boleh kosong' });
      await save(n);
      return out(200, { ok: true, note: n });
    }

    // ---- ROOT
    if (req.method === 'GET') {
      let ns = await all();
      if (q.export === '1') return out(200, { ok: true, count: ns.length, notes: sortNotes(ns) });
      ns = ns.filter((n) => (q.trash === '1') === !!n.trashed);
      if (q.tag) ns = ns.filter((n) => (n.tags || []).includes(q.tag.toLowerCase()));
      if (q.pinned === '1') ns = ns.filter((n) => n.pinned);
      sortNotes(ns);
      if (q.limit) ns = ns.slice(0, Math.max(1, +q.limit || 50));
      return out(200, { ok: true, count: ns.length, notes: ns });
    }
    if (req.method === 'POST') {
      if (q.import === '1') {
        const list = Array.isArray(b.notes) ? b.notes : [];
        for (const x of list) {
          const nid = String(x.id || crypto.randomBytes(4).toString('hex'));
          const n = build(x, { id: nid, title: '', content: '', tags: [], color: 'yellow', pinned: false, trashed: false, created: x.created || now, updated: x.updated || now });
          if (n.title && n.content) await save(n);
        }
        return out(200, { ok: true, imported: list.length });
      }
      if (!b.title || !b.content) return out(400, { ok: false, error: 'Wajib isi title dan content' });
      const nid = crypto.randomBytes(4).toString('hex');
      const n = build(b, { id: nid, title: '', content: '', tags: [], color: 'yellow', pinned: false, trashed: false, created: now, updated: now });
      await save(n);
      return out(201, { ok: true, note: n });
    }
    if (req.method === 'DELETE' && q.empty_trash === '1') {
      const t = (await all()).filter((n) => n.trashed);
      for (const n of t) await redis('HDEL', HASH, n.id);
      return out(200, { ok: true, purged: t.length });
    }
    return out(400, { ok: false, error: 'Request tidak dikenali, baca AGENT.md' });
  } catch (e) {
    return out(500, { ok: false, error: e.message });
  }
};
