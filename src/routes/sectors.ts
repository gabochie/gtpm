// ============================================================
// GTPM — /api/sectors + /api/technologies + /api/people
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/sectors — all sectors with org counts */
app.get('/', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM organization_sectors os WHERE os.sector_id = s.id) AS org_count,
      (SELECT COUNT(*) FROM organization_sectors os
        JOIN organizations o ON o.id = os.organization_id
        WHERE os.sector_id = s.id AND o.founded_year IS NOT NULL) AS known_orgs
    FROM sectors s
    ORDER BY org_count DESC, s.name`).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, parent_id: r.parent_id, description: r.description,
      sort_order: r.sort_order, org_count: r.org_count,
    })),
    meta: { total: rows.results.length },
  });
});

/** GET /api/sectors/:slug — sector intelligence page */
app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const sector = await db.prepare(`SELECT * FROM sectors WHERE slug = ?`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!sector) return c.json({ error: 'not_found' }, 404);
  const sid = sector.id as string;
  const [orgs, technologies, funding, opportunities] = await Promise.all([
    db.prepare(`
      SELECT o.*, l.name AS hq_city FROM organization_sectors os
      JOIN organizations o ON o.id = os.organization_id
      LEFT JOIN locations l ON l.id = o.hq_location_id
      WHERE os.sector_id = ? AND o.is_private = 0
      ORDER BY o.confidence DESC`).bind(sid).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT t.*, COUNT(ot.organization_id) AS org_count FROM technologies t
      LEFT JOIN organization_technologies ot ON ot.technology_id = t.id
      WHERE t.id IN (SELECT ot.technology_id FROM organization_technologies ot
        JOIN organization_sectors os ON os.organization_id = ot.organization_id WHERE os.sector_id = ?)
      GROUP BY t.id`).bind(sid).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT COALESCE(SUM(fr.amount_usd), 0) AS total_usd, COUNT(*) AS rounds FROM funding_rounds fr
      JOIN organization_sectors os ON os.organization_id = fr.organization_id
      WHERE os.sector_id = ?`).bind(sid).first<{ total_usd: number; rounds: number }>(),
    db.prepare(`SELECT * FROM opportunities WHERE sector_id = ? AND status = 'open' ORDER BY attractiveness DESC LIMIT 10`).bind(sid).all<Record<string, unknown>>(),
  ]);
  return c.json({
    data: {
      ...sector,
      org_count: orgs.results.length,
      organizations: orgs.results.map((r) => ({ id: r.id, slug: r.slug, name: r.name, org_type: r.org_type, description: r.description, founded_year: r.founded_year, hq_city: r.hq_city, website: r.website, confidence: r.confidence })),
      technologies: technologies.results,
      funding: { total_usd: funding?.total_usd ?? 0, rounds: funding?.rounds ?? 0 },
      opportunities: opportunities.results,
    },
  });
});

export default app;
