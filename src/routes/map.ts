// ============================================================
// GTPM — /api/map (spec §16 Technology Power Map)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/map — organisations geolocated by city, plus hubs/universities */
app.get('/', async (c) => {
  const db = c.env.DB;
  const sector = c.req.query('sector');
  const orgType = c.req.query('type');

  let sectorClause = '';
  let typeClause = '';
  const params: unknown[] = [];
  if (sector) { sectorClause = `AND o.id IN (SELECT organization_id FROM organization_sectors WHERE sector_id = (SELECT id FROM sectors WHERE slug = ?))`; params.push(sector); }
  if (orgType) { typeClause = 'AND o.org_type = ?'; params.push(orgType); }

  const rows = await db.prepare(`
    SELECT l.id AS location_id, l.name AS city, l.lat, l.lng,
      COUNT(o.id) AS org_count,
      SUM(CASE WHEN o.org_type IN ('accelerator','incubator','community','university','research') THEN 1 ELSE 0 END) AS hub_count,
      GROUP_CONCAT(o.name, '|||') AS org_names,
      GROUP_CONCAT(o.slug, '|||') AS org_slugs
    FROM locations l
    LEFT JOIN organizations o ON o.hq_location_id = l.id AND o.is_private = 0 ${sectorClause} ${typeClause}
    WHERE l.type = 'city'
    GROUP BY l.id
    HAVING org_count > 0
    ORDER BY org_count DESC`).bind(...params).all<Record<string, unknown>>();

  return c.json({
    data: rows.results.map((r) => ({
      location_id: r.location_id, city: r.city, lat: r.lat, lng: r.lng,
      org_count: r.org_count, hub_count: r.hub_count,
      orgs: String(r.org_names ?? '').split('|||').filter(Boolean).map((name, i) => ({ name, slug: String(r.org_slugs).split('|||')[i] })),
    })),
    meta: { generated_at: new Date().toISOString() },
  });
});

/** GET /api/map/clusters — sector concentration by city (heatmap data) */
app.get('/clusters', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(`
    SELECT l.name AS city, l.lat, l.lng, s.name AS sector, COUNT(*) AS count
    FROM organization_sectors os
    JOIN organizations o ON o.id = os.organization_id AND o.is_private = 0
    JOIN locations l ON l.id = o.hq_location_id
    JOIN sectors s ON s.id = os.sector_id
    WHERE l.type = 'city'
    GROUP BY l.id, s.id
    ORDER BY count DESC`).all<Record<string, unknown>>();
  return c.json({ data: rows.results });
});

export default app;
