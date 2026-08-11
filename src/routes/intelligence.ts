// ============================================================
// GTPM — /api/intelligence (spec §12 Daily Brief + strategic summaries)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

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

export default app;
