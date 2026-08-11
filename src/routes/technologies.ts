// ============================================================
// GTPM — /api/technologies (Technology Radar, spec §8 Agent 5)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/technologies — radar list */
app.get('/', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(`
    SELECT t.*, COUNT(ot.organization_id) AS org_count,
      (SELECT COUNT(*) FROM technology_signals ts WHERE ts.technology_id = t.id) AS signal_count
    FROM technologies t
    LEFT JOIN organization_technologies ot ON ot.technology_id = t.id
    GROUP BY t.id
    ORDER BY CASE t.radar_ring
      WHEN 'ACCELERATING' THEN 0 WHEN 'MAINSTREAM' THEN 1 WHEN 'EMERGING' THEN 2
      WHEN 'EXPERIMENTAL' THEN 3 ELSE 4 END, org_count DESC`).all<Record<string, unknown>>();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

/** GET /api/technologies/:slug */
app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const tech = await db.prepare(`SELECT * FROM technologies WHERE slug = ?`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!tech) return c.json({ error: 'not_found' }, 404);
  const tid = tech.id as string;
  const [orgs, signals] = await Promise.all([
    db.prepare(`
      SELECT o.*, ot.adoption_level FROM organization_technologies ot
      JOIN organizations o ON o.id = ot.organization_id
      WHERE ot.technology_id = ? AND o.is_private = 0
      ORDER BY o.confidence DESC`).bind(tid).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT ts.*, o.name AS org_name, o.slug AS org_slug FROM technology_signals ts
      LEFT JOIN organizations o ON o.id = ts.organization_id
      WHERE ts.technology_id = ? ORDER BY ts.date DESC LIMIT 30`).bind(tid).all<Record<string, unknown>>(),
  ]);
  return c.json({
    data: { ...tech, org_count: orgs.results.length, organizations: orgs.results, signals: signals.results },
  });
});

export default app;
