const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

// The three exercises of a day's workout, in the order they are played.
const EXERCISES = ['reaction', 'memory', 'words'];
const EXERCISE_SET = new Set(EXERCISES);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');
// This project's address on the platform (/app/<slug>), from the variable the
// platform injects, and not written in here either: every project made from
// the same starter is then the same code. Unset only outside the platform.
const APP_SLUG = process.env.USERNODE_APP_SLUG || '';

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Homeroom's requests about one person's data: erase it when they delete
// their account, export it when they ask for a copy. Mounted BEFORE the
// sign-in check because they carry a platform token of their own, which
// usernode-user-data.js verifies. When you add a table, check that file's
// OWNED_BY and SKIP lists ("Your people's data" in the platform conventions).
require('./usernode-user-data').mount(app, pool);

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── NeuroBoost: one workout a day, three exercises ───────────────────────
// A person's scores, one row per exercise per local day. Idempotent on
// every boot, and staging-only rows: the table is private, so a staging
// preview starts empty and the `?demo=1` rows are added to responses
// rather than stored.
async function ensureSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS results (
       id serial PRIMARY KEY,
       user_id text NOT NULL,
       exercise text NOT NULL CHECK (exercise IN ('reaction', 'memory', 'words')),
       score integer NOT NULL CHECK (score >= 0 AND score <= 100),
       day date NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       UNIQUE (user_id, exercise, day)
     )`);
  await pool.query(`COMMENT ON TABLE results IS 'staging:private'`);
}

// The day as the person sees it, computed in the server's timezone.
function dayString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(day, offset) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((da - db) / 86400000);
}

function rowOut(row) {
  return {
    id: row.id,
    exercise: row.exercise,
    score: row.score,
    day: typeof row.day === 'string' ? row.day.slice(0, 10) : dayString(row.day),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// Fixed sample results for the first version's populated demo, relative to
// the day the page is looking at. 14 rows across 7 played days, all three
// exercises, two under 50, and today's reaction exercise already done.
function demoRows(baseDay) {
  const plan = [
    [0, 'reaction', 86, '08:15'],
    [-1, 'memory', 72, '19:40'],
    [-1, 'words', 92, '19:42'],
    [-2, 'reaction', 65, '08:10'],
    [-2, 'memory', 58, '08:12'],
    [-2, 'words', 74, '08:14'],
    [-3, 'reaction', 48, '08:20'],
    [-3, 'memory', 41, '08:22'],
    [-4, 'reaction', 77, '07:55'],
    [-4, 'words', 71, '07:58'],
    [-5, 'memory', 62, '18:30'],
    [-5, 'words', 52, '18:33'],
    [-6, 'reaction', 55, '09:05'],
    [-6, 'words', 69, '09:08'],
  ];
  return plan.map(([offset, exercise, score, time], index) => ({
    id: -(index + 1),
    exercise,
    score,
    day: addDays(baseDay, offset),
    created_at: `${addDays(baseDay, offset)}T${time}:00.000Z`,
  }));
}

// Last 7 played days, oldest first, each with its rounded average.
function summariseDays(rows) {
  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push(row.score);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 7)
    .map(([day, scores]) => ({
      day,
      average: Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length),
    }))
    .reverse();
}

function isDemo(req) {
  return IS_STAGING && req.query.demo === '1';
}

// `today`, `recent` and `days` for one person. A guest, or a signed-in
// person with no rows yet, gets the same shape empty.
app.get('/api/summary', async (req, res) => {
  const requested = typeof req.query.day === 'string' && DAY_RE.test(req.query.day)
    ? req.query.day
    : dayString(req.now);
  try {
    if (isDemo(req)) {
      // Compute the whole answer from the viewer's real rows plus the fixed
      // demo list, minus demo rows that would duplicate a real one.
      let real = [];
      if (req.user) {
        const { rows } = await pool.query(
          `SELECT id, exercise, score, day::text AS day, created_at
             FROM results WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
          [req.user.id]);
        real = rows.map(rowOut);
      }
      const realKeys = new Set(real.map((r) => `${r.exercise}:${r.day}`));
      const demo = demoRows(requested).filter((r) => !realKeys.has(`${r.exercise}:${r.day}`));
      const merged = real.concat(demo)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
      return res.json({
        today: merged.filter((r) => r.day === requested),
        recent: merged.slice(0, 10),
        days: summariseDays(merged),
      });
    }

    if (!req.user) return res.json({ today: [], recent: [], days: [] });

    const [today, recent, days] = await Promise.all([
      pool.query(
        `SELECT id, exercise, score, day::text AS day, created_at
           FROM results WHERE user_id = $1 AND day = $2
          ORDER BY created_at ASC, id ASC`,
        [req.user.id, requested]),
      pool.query(
        `SELECT id, exercise, score, day::text AS day, created_at
           FROM results WHERE user_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 10`,
        [req.user.id]),
      pool.query(
        `SELECT day::text AS day, ROUND(AVG(score))::int AS average
           FROM results WHERE user_id = $1
          GROUP BY day ORDER BY day DESC LIMIT 7`,
        [req.user.id]),
    ]);
    return res.json({
      today: today.rows.map(rowOut),
      recent: recent.rows.map(rowOut),
      days: days.rows.map((r) => ({ day: r.day, average: r.average })).reverse(),
    });
  } catch (err) {
    console.error('summary failed: ' + err.message);
    return res.status(500).json({ error: 'summary_failed' });
  }
});

// One score for one exercise on one day. A second attempt that day answers
// 409; the page then reloads the summary, which shows the saved score.
app.post('/api/results', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  const { exercise, score, day } = req.body || {};
  if (!EXERCISE_SET.has(exercise)) return res.status(400).json({ error: 'invalid_exercise' });
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'invalid_score' });
  }
  if (typeof day !== 'string' || !DAY_RE.test(day)) return res.status(400).json({ error: 'invalid_day' });
  // The person's own clock decides the day, but a day more than one away
  // from the server's is a clock or a payload that cannot be trusted.
  if (Math.abs(daysBetween(day, dayString(req.now))) > 1) {
    return res.status(400).json({ error: 'invalid_day' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO results (user_id, exercise, score, day)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, exercise, day) DO NOTHING
       RETURNING id, exercise, score, day::text AS day, created_at`,
      [req.user.id, exercise, score, day]);
    if (!rows.length) return res.status(409).json({ error: 'already_recorded' });
    return res.status(201).json(rowOut(rows[0]));
  } catch (err) {
    console.error('save result failed: ' + err.message);
    return res.status(500).json({ error: 'save_failed' });
  }
});

// Deleting today's row reopens that exercise. A demo row (negative id)
// exists only in the `?demo=1` answer, so it is never in the database: the
// page drops it locally and this answers 204.
app.delete('/api/results/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
  if (id < 0) {
    if (isDemo(req)) return res.status(204).end();
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM results WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    return res.status(204).end();
  } catch (err) {
    console.error('delete result failed: ' + err.message);
    return res.status(500).json({ error: 'delete_failed' });
  }
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    const appPath = APP_SLUG ? '/app/' + encodeURIComponent(APP_SLUG) + '/full' + deepPath : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + appPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}${appPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await ensureSchema();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Stop accepting connections, give in-flight requests about 3 seconds,
  // then close the pool and exit.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => {
      pool.end().finally(() => process.exit(0));
    }, 3000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
