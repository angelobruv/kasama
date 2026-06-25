const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = process.env.PORT || 3000;

// --- storage: Postgres if DATABASE_URL is set, else in-memory (fine for local/demo) ---
let pool = null;
const mem = new Map();
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query(`CREATE TABLE IF NOT EXISTS kasama_annotations(
    slug text primary key, data jsonb not null default '[]', updated_at timestamptz default now())`)
    .then(() => console.log('kasama_annotations table ready'))
    .catch((e) => console.error('DB init error:', e.message));
} else {
  console.warn('No DATABASE_URL set — using an in-memory store (resets on restart).');
}

app.use(express.json({ limit: '5mb' }));
app.get('/healthz', (req, res) => res.send('ok'));

// --- the widget: one <script> tag injects the CSS and runs the engine ---
const CSS = fs.readFileSync(path.join(__dirname, 'src', 'kasama.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, 'src', 'kasama.js'), 'utf8');
const WIDGET = `(function(){var s=document.createElement('style');s.id='kasama-style';` +
  `s.textContent=${JSON.stringify(CSS)};(document.head||document.documentElement).appendChild(s);})();\n${JS}`;
app.get('/kasama.js', (req, res) => res.type('application/javascript').set('cache-control', 'public, max-age=300').send(WIDGET));
app.get('/kasama.css', (req, res) => res.type('text/css').send(CSS));

// --- annotations API — the comment store. A page's comments are one JSON array, keyed by slug. ---
app.get('/api/annotations/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (pool) {
    try { const { rows } = await pool.query('SELECT data FROM kasama_annotations WHERE slug=$1', [slug]); return res.json(rows.length ? rows[0].data : []); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json(mem.get(slug) || []);
});
app.post('/api/annotations/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'body must be an array' });
  if (pool) {
    try {
      await pool.query(`INSERT INTO kasama_annotations(slug, data, updated_at) VALUES($1, $2::jsonb, now())
        ON CONFLICT(slug) DO UPDATE SET data=$2::jsonb, updated_at=now()`, [slug, JSON.stringify(req.body)]);
      return res.json({ ok: true, count: req.body.length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  mem.set(slug, req.body);
  res.json({ ok: true, count: req.body.length });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));

app.listen(PORT, () => console.log(`Kasama self-host running on http://localhost:${PORT}`));
