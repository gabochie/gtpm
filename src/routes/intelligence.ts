// ============================================================
// GTPM — /api/intelligence (spec §12 Daily Brief + strategic summaries)
// ============================================================
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { D1Database } from '../types-d1';
import { uuid, nowIso } from '../lib/utils';
import { scoreAllOrganizations } from '../lib/scoring';
import { snapshotAllOrganizations } from '../lib/monitor';

const app = new Hono<{ Bindings: { DB: D1Database; API_KEY_HASH?: string } }>();

// In-memory gate so the POST endpoints can't be hammered in dev.
const RUN_LOCK = { active: false };

/** Write gate for the run/score endpoints (Phase 4 precursor, mirrors index.ts). */
async function requireWrite(c: Context<{ Bindings: { DB: D1Database; API_KEY_HASH?: string } }>): Promise<boolean> {
  const key = c.req.header('x-api-key');
  if (!key) return false;
  const expected = c.env.API_KEY_HASH;
  return expected ? key === expected : true;
}

/** GET /api/intelligence/brief — the GTPM Daily Brief structure (spec §12) */
app.get('/brief', async (c) => {
  const db = c.env.DB;
  const [signals, funding, events, opportunities, orgs] = await Promise.all([
    db.prepare(`SELECT s.*, o.name AS org_name, o.slug AS org_slug FROM signals s LEFT JOIN organizations o ON o.id = s.organization_id ORDER BY s.date DESC LIMIT 20`).all<Record<string, unknown>>(),
    db.prepare(`SELECT fr.*, o.name AS org_name, o.slug AS org_slug FROM funding_rounds fr JOIN organizations o ON o.id = fr.organization_id ORDER BY COALESCE(fr.date,'') DESC LIMIT 10`).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM events WHERE importance IN ('critical','important') ORDER BY COALESCE(date,'') DESC LIMIT 10`).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM opportunities WHERE status='open' ORDER BY attractiveness DESC LIMIT 10`).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, slug, name, org_type, founded_year, confidence FROM organizations WHERE is_private = 0 ORDER BY confidence DESC LIMIT 15`).all<Record<string, unknown>>(),
  ]);
  return c.json({
    data: {
      generated_at: new Date().toISOString(),
      sections: {
        top_developments: events.results,
        unusual_movement: signals.results.filter((s) => (s.importance as string) !== 'signal').slice(0, 5),
        funding_signals: funding.results.slice(0, 5),
        emerging_technologies: [],
        strategic_threats: [],
        opportunities: opportunities.results.slice(0, 5),
        watch: orgs.results.slice(0, 5),
      },
    },
    meta: { note: 'Structured brief template — AI-generated narratives arrive in Phase 3 (spec §12)' },
  });
});

/** GET /api/intelligence/market — cross-sector market summary */
app.get('/market', async (c) => {
  const db = c.env.DB;
  const bySector = await db.prepare(`
    SELECT s.name, s.slug, COUNT(DISTINCT os.organization_id) AS orgs,
      COALESCE(SUM(CASE WHEN fr.id IS NOT NULL THEN fr.amount_usd END), 0) AS funding_usd
    FROM sectors s
    LEFT JOIN organization_sectors os ON os.sector_id = s.id
    LEFT JOIN funding_rounds fr ON fr.organization_id = os.organization_id
    GROUP BY s.id
    HAVING orgs > 0
    ORDER BY orgs DESC`).all<Record<string, unknown>>();
  const momentum = await db.prepare(`
    SELECT s.name AS sector, s.slug AS sector_slug, COUNT(si.id) AS signal_count
    FROM sectors s
    LEFT JOIN organization_sectors os ON os.sector_id = s.id
    LEFT JOIN signals si ON si.organization_id = os.organization_id
    GROUP BY s.id HAVING signal_count > 0 ORDER BY signal_count DESC`).all<Record<string, unknown>>();
  return c.json({ data: { by_sector: bySector.results, momentum } });
});

/** GET /api/intelligence/runs — recent agent run history */
app.get('/runs', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT id, agent_name, status, items_processed, started_at, finished_at, output
     FROM agent_runs ORDER BY started_at DESC LIMIT 20`
  ).all<Record<string, unknown>>();
  return c.json({ data: rows.results });
});

function agentRunInsert(db: D1Database, agentName: string, status: string, items: number, output: string, started: string, error: string | null = null) {
  return db.prepare(
    `INSERT INTO agent_runs (id, agent_name, status, input, output, error, items_processed, started_at, finished_at)
     VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?)`
  ).bind(uuid(), agentName, status, output, error, items, started, nowIso());
}

/** POST /api/intelligence/score — recompute all organisation scores */
app.post('/score', async (c) => {
  if (!(await requireWrite(c))) return c.json({ error: 'api_key_required' }, 401);
  if (RUN_LOCK.active) return c.json({ error: 'run_in_progress' }, 409);
  RUN_LOCK.active = true;
  const db = c.env.DB;
  const started = nowIso();
  try {
    const summary = await scoreAllOrganizations(db);
    await agentRunInsert(db, 'scoring', 'success', summary.orgs_scored, JSON.stringify(summary), started).run();
    return c.json({ data: summary });
  } catch (e) {
    await agentRunInsert(db, 'scoring', 'failed', 0, '{}', started, String(e)).run();
    return c.json({ error: 'scoring_failed', detail: String(e) }, 500);
  } finally {
    RUN_LOCK.active = false;
  }
});

/** POST /api/intelligence/run — full monitor pass: score + snapshot + log */
app.post('/run', async (c) => {
  if (!(await requireWrite(c))) return c.json({ error: 'api_key_required' }, 401);
  if (RUN_LOCK.active) return c.json({ error: 'run_in_progress' }, 409);
  RUN_LOCK.active = true;
  const db = c.env.DB;
  const started = nowIso();
  try {
    const [scoreSummary, monitorSummary] = await Promise.all([
      scoreAllOrganizations(db),
      snapshotAllOrganizations(db),
    ]);
    const output = JSON.stringify({ scoring: scoreSummary, monitoring: monitorSummary });
    await agentRunInsert(db, 'full_monitor', 'success', scoreSummary.orgs_scored, output, started).run();
    return c.json({ data: { scoring: scoreSummary, monitoring: monitorSummary } });
  } catch (e) {
    await agentRunInsert(db, 'full_monitor', 'failed', 0, '{}', started, String(e)).run();
    return c.json({ error: 'monitor_run_failed', detail: String(e) }, 500);
  } finally {
    RUN_LOCK.active = false;
  }
});

export default app;
