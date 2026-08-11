// ============================================================
// GTPM — /api/stats — platform-wide numbers for homepage/command centre
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

app.get('/', async (c) => {
  const db = c.env.DB;
  const [orgs, sectors, technologies, funding, signals, opportunities, people, cities] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM organizations WHERE is_private = 0`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM sectors`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM technologies`).first<{ n: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount_usd),0) AS total, COUNT(*) AS rounds FROM funding_rounds`).first<{ total: number; rounds: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM signals`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE status = 'open'`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM people`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT hq_location_id) AS n FROM organizations WHERE hq_location_id IS NOT NULL AND is_private = 0`).first<{ n: number }>(),
  ]);
  const topSignals = await db.prepare(`
    SELECT s.*, o.name AS org_name, o.slug AS org_slug FROM signals s
    LEFT JOIN organizations o ON o.id = s.organization_id
    ORDER BY s.date DESC LIMIT 6`).all<Record<string, unknown>>();
  const topOrgs = await db.prepare(`
    SELECT o.id, o.slug, o.name, o.org_type, o.confidence, o.founded_year, l.name AS hq_city
    FROM organizations o LEFT JOIN locations l ON l.id = o.hq_location_id
    WHERE o.is_private = 0 ORDER BY o.confidence DESC, o.founded_year DESC LIMIT 10`).all<Record<string, unknown>>();
  return c.json({
    data: {
      orgs: orgs?.n ?? 0, sectors: sectors?.n ?? 0, technologies: technologies?.n ?? 0,
      people: people?.n ?? 0, cities: cities?.n ?? 0, signals: signals?.n ?? 0,
      opportunities: opportunities?.n ?? 0,
      funding_total_usd: funding?.total ?? 0, funding_rounds: funding?.rounds ?? 0,
      top_signals: topSignals.results, top_orgs: topOrgs.results,
    },
    meta: { generated_at: new Date().toISOString() },
  });
});

export default app;
