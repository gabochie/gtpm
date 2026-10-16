// ============================================================
// GTPM — /api/discovery (Agent 1 Ecosystem Scout + §7 source pipeline)
//
// POST /run        — one scout pass (fetch due sources)
// GET  /queue      — pending discovery candidates
// POST /queue/:id  — resolve candidate (approve → create org)
// GET  /sources    — source registry with fetch status
// POST /ingest     — analyst-submitted news item
// ============================================================
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { D1Database } from '../types-d1';
import { uuid, nowIso, slugify } from '../lib/utils';
import { runScoutPass, ingestNewsItem } from '../lib/scout';

const app = new Hono<{ Bindings: { DB: D1Database; API_KEY_HASH?: string } }>();

const RUN_LOCK = { active: false };

type IngestBody = { title?: string; url?: string; publisher?: string; summary?: string; published_date?: string };
type ResolveBody = { action?: string; org_type?: string; proposed_sector?: string };

async function requireWrite(c: Context<{ Bindings: { DB: D1Database; API_KEY_HASH?: string } }>): Promise<boolean> {
  const key = c.req.header('x-api-key');
  if (!key) return false;
  const expected = c.env.API_KEY_HASH;
  return expected ? key === expected : true;
}

/** GET /api/discovery/sources — registry with fetch health */
app.get('/sources', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT id, title, publisher, source_type, reliability, fetch_frequency, last_fetched, next_fetch, fetch_status, robots_allowed
    FROM sources ORDER BY fetch_status = 'blocked', reliability DESC LIMIT 100`).all<Record<string, unknown>>();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

/** POST /api/discovery/run — one scout pass over due sources */
app.post('/run', async (c) => {
  if (!(await requireWrite(c))) return c.json({ error: 'api_key_required' }, 401);
  if (RUN_LOCK.active) return c.json({ error: 'run_in_progress' }, 409);
  RUN_LOCK.active = true;
  const db = c.env.DB;
  const started = nowIso();
  try {
    const summary = await runScoutPass(db);
    await db.prepare(
      `INSERT INTO agent_runs (id, agent_name, status, input, output, error, items_processed, started_at, finished_at)
       VALUES (?, ?, 'success', '{}', ?, NULL, ?, ?, ?)`
    ).bind(uuid(), 'scout', JSON.stringify(summary), summary.items_parsed, started, nowIso()).run();
    return c.json({ data: summary });
  } catch (e) {
    await db.prepare(
      `INSERT INTO agent_runs (id, agent_name, status, input, output, error, items_processed, started_at, finished_at)
       VALUES (?, ?, 'failed', '{}', '{}', ?, 0, ?, ?)`
    ).bind(uuid(), 'scout', String(e), started, nowIso()).run();
    return c.json({ error: 'scout_failed', detail: String(e) }, 500);
  } finally {
    RUN_LOCK.active = false;
  }
});

/** POST /api/discovery/ingest — analyst-submitted news item through the full pipeline */
app.post('/ingest', async (c) => {
  if (!(await requireWrite(c))) return c.json({ error: 'api_key_required' }, 401);
  const body = await c.req.json<IngestBody>().catch(() => ({}) as IngestBody);
  if (!body.title?.trim()) return c.json({ error: 'title_required' }, 400);
  try {
    const result = await ingestNewsItem(c.env.DB, {
      title: body.title, url: body.url, publisher: body.publisher, summary: body.summary, published_date: body.published_date,
    });
    return c.json({ data: result });
  } catch (e) {
    return c.json({ error: 'ingest_failed', detail: String(e) }, 500);
  }
});

/** GET /api/discovery/queue — pending candidates */
app.get('/queue', async (c) => {
  const q = c.req.query();
  const status = q['status'] ?? 'pending';
  const limit = Math.min(100, parseInt(q['limit'] ?? '50', 10) || 50);
  const page = Math.max(1, parseInt(q['page'] ?? '1', 10) || 1);
  const offset = (page - 1) * limit;
  const [totalRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM discovery_queue WHERE status = ?`).bind(status).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT * FROM discovery_queue WHERE status = ? ORDER BY confidence DESC, created_at DESC LIMIT ? OFFSET ?`
    ).bind(status, limit, offset).all<Record<string, unknown>>(),
  ]);
  return c.json({ data: rows.results, meta: { total: totalRow?.n ?? 0, page, limit } });
});

/**
 * POST /api/discovery/queue/:id — resolve a candidate.
 * body.action: approve (creates a minimal organisation) | reject | duplicate
 */
app.post('/queue/:id', async (c) => {
  if (!(await requireWrite(c))) return c.json({ error: 'api_key_required' }, 401);
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json<ResolveBody>().catch(() => ({}) as ResolveBody);
  const action = body.action ?? 'approve';

  const candidate = await db.prepare(`SELECT * FROM discovery_queue WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);

  if (action === 'reject' || action === 'duplicate') {
    await db.prepare(`UPDATE discovery_queue SET status = ? WHERE id = ?`).bind(action, id).run();
    return c.json({ data: { id, status: action } });
  }

  if (action !== 'approve') return c.json({ error: 'invalid_action' }, 400);

  const name = candidate.name as string;
  const slug = slugify(name);
  const existing = await db.prepare(`SELECT id FROM organizations WHERE slug = ?`).bind(slug).first<{ id: string }>();
  if (existing) {
    await db.prepare(`UPDATE discovery_queue SET status = 'duplicate' WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, status: 'duplicate', existing_org: existing.id } });
  }

  const orgType = (body.org_type ?? candidate.proposed_type ?? 'startup') as string;
  const orgId = uuid();
  await db.batch([
    db.prepare(
      `INSERT INTO organizations (id, slug, name, org_type, description, website, status, verification_status, confidence, monitor_frequency, is_private, is_seed, socials, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'reported', 0.4, 'monthly', 0, 0, '{}', ?, ?)`
    ).bind(orgId, slug, name, orgType, candidate.notes ?? null, candidate.url ?? null, nowIso(), nowIso()),
    db.prepare(`UPDATE discovery_queue SET status = 'resolved' WHERE id = ?`).bind(id),
  ]);
  return c.json({ data: { id, status: 'resolved', organization_id: orgId, slug } });
});

export default app;
