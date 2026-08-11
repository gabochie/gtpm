// ============================================================
// GTPM — /api/relationships (spec §15 Relationship Graph)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

const NAME_LOOKUP = `
  SELECT 'organization' AS entity_type, id, slug, name FROM organizations
  UNION ALL SELECT 'person', id, slug, name FROM people
  UNION ALL SELECT 'product', id, slug, name FROM products
  UNION ALL SELECT 'technology', id, slug, name FROM technologies
  UNION ALL SELECT 'sector', id, slug, name FROM sectors`;

/** GET /api/relationships?org=slug — ego graph for one organization */
app.get('/', async (c) => {
  const db = c.env.DB;
  const orgSlug = c.req.query('org');
  if (!orgSlug) {
    // full graph: sample of relationships (bounded)
    const rows = await db.prepare(`SELECT * FROM relationships LIMIT 500`).all<Record<string, unknown>>();
    const names = await db.prepare(NAME_LOOKUP).all<Record<string, unknown>>();
    const nameMap = new Map(names.results.map((n) => [`${n.entity_type}:${n.id}`, { slug: n.slug, name: n.name }]));
    return c.json({
      data: {
        nodes: names.results.map((n) => ({ id: `${n.entity_type}:${n.id}`, type: n.entity_type, slug: n.slug, name: n.name })),
        edges: rows.results.map((r) => ({ source: `${r.from_entity_type}:${r.from_entity_id}`, target: `${r.to_entity_type}:${r.to_entity_id}`, type: r.relationship_type, label: r.description })),
      },
    });
  }
  const org = await db.prepare(`SELECT id, name FROM organizations WHERE slug = ?`).bind(orgSlug).first<{ id: string; name: string }>();
  if (!org) return c.json({ error: 'not_found' }, 404);

  // competitors + partnerships as relationship edges, plus sector/tech links
  const [competitors, partnerships, sectors, technologies] = await Promise.all([
    db.prepare(`
      SELECT 'competitor' AS rel, c.competition_type AS rel_type, co.id AS other_id, co.name AS other_name, co.org_type AS other_type
      FROM competitors c JOIN organizations co ON co.id = c.competitor_org_id WHERE c.organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT 'partner' AS rel, p.partnership_type AS rel_type, o.id AS other_id, o.name AS other_name, o.org_type AS other_type
      FROM partnerships p JOIN organizations o ON o.id = p.org_b_id WHERE p.org_a_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT 'sector' AS rel, 'in_sector' AS rel_type, s.id AS other_id, s.name AS other_name, 'sector' AS other_type
      FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id WHERE os.organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT 'technology' AS rel, 'uses' AS rel_type, t.id AS other_id, t.name AS other_name, 'technology' AS other_type
      FROM organization_technologies ot JOIN technologies t ON t.id = ot.technology_id WHERE ot.organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
  ]);

  const edges = [...competitors.results, ...partnerships.results, ...sectors.results, ...technologies.results];
  const nodes = [
    { id: `organization:${org.id}`, type: 'organization', name: org.name },
    ...edges.map((e) => ({ id: `${e.other_type}:${e.other_id}`, type: e.other_type, name: e.other_name })),
  ];
  // dedupe nodes
  const seen = new Set<string>();
  const deduped = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));

  return c.json({
    data: {
      nodes: deduped,
      edges: edges.map((e) => ({
        source: `organization:${org.id}`, target: `${e.other_type}:${e.other_id}`,
        type: e.rel_type, label: e.rel === 'competitor' ? `competitor (${e.rel_type})` : e.rel_type,
      })),
    },
  });
});

/** GET /api/relationships/types — edge type taxonomy with counts */
app.get('/types', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(`SELECT relationship_type, COUNT(*) AS count FROM relationships GROUP BY relationship_type ORDER BY count DESC`).all<Record<string, unknown>>();
  return c.json({ data: rows.results });
});

export default app;
