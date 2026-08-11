// ============================================================
// GTPM — Ghana Technology & Power Map
// Worker entry: Hono API + static assets + D1
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from './types-d1';
import companies from './routes/companies';
import people from './routes/people';
import sectors from './routes/sectors';
import technologies from './routes/technologies';
import funding from './routes/funding';
import { events, signals } from './routes/signals';
import opportunities from './routes/opportunities';
import relationships from './routes/relationships';
import reports from './routes/reports';
import search from './routes/search';
import intelligence from './routes/intelligence';
import map from './routes/map';
import stats from './routes/stats';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  API_KEY_HASH?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------------------
// Security headers on every response (spec §37)
// ------------------------------------------------------------
app.use('*', async (c, next) => {
  await next();
  try {
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    h.set('X-Robots-Tag', 'index, follow');
  } catch {
    // Response headers immutable (e.g. ASSETS 404 for missing files) — serve as-is
  }
});

// Simple API key check for machine access (Phase 4 precursor)
async function requireApiKey(c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) {
  const key = c.req.header('x-api-key');
  const env = c.env as Bindings;
  if (key && env.API_KEY_HASH && key === env.API_KEY_HASH) {
    await next();
    return;
  }
  // public GET endpoints are open; write endpoints will require key in Phase 4
  await next();
}

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'gtpm', time: new Date().toISOString() }));

// API routes
app.route('/api/companies', companies);
app.route('/api/people', people);
app.route('/api/sectors', sectors);
app.route('/api/technologies', technologies);
app.route('/api/funding', funding);
app.route('/api/events', events);
app.route('/api/signals', signals);
app.route('/api/opportunities', opportunities);
app.route('/api/relationships', relationships);
app.route('/api/reports', reports);
app.route('/api/search', search);
app.route('/api/intelligence', intelligence);
app.route('/api/map', map);
app.route('/api/stats', stats);

app.use('/api/*', async (c, next) => {
  await next();
  if (c.res.status === 404) {
    return c.json({ error: 'not_found', message: 'API endpoint not found' }, 404);
  }
});

// 404 for unknown API paths
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found', message: `No route for ${c.req.path}` }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
