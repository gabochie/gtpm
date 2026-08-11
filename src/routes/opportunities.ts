// ============================================================
// GTPM — /api/opportunities (spec §8 Agent 9, §31 Opportunity Radar)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseListQuery, parseJson, buildWhere } from '../lib/utils';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

app.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = ["o.status = 'open'"];
  const params: unknown[] = [];
  if (q.type) { params.push(q.type); clauses.push('o.classification = ?'); }
  if (q.sector) {
    clauses.push('o.sector_id = (SELECT id FROM sectors WHERE slug = ?)');
    params.push(q.sector);
  }
  const { where } = buildWhere(clauses, params);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM opportunities o ${where}`).bind(...params).first<{ total: number }>();
  const total = totalRow?.total ?? 0;
  const rows = await db.prepare(`
    SELECT o.*, s.name AS sector_name, s.slug AS sector_slug FROM opportunities o
    LEFT JOIN sectors s ON s.id = o.sector_id
    ${where}
    ORDER BY o.attractiveness DESC
    LIMIT ? OFFSET ?`).bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, problem: r.problem, market: r.market,
      sector: r.sector_name ? { slug: r.sector_slug, name: r.sector_name } : null,
      existing_alternatives: parseJson<string[]>(r.existing_alternatives as string, []),
      current_competitors: parseJson<string[]>(r.current_competitors as string, []),
      why_now: r.why_now, technology_required: parseJson<string[]>(r.technology_required as string, []),
      barriers: parseJson<string[]>(r.barriers as string, []), potential_customers: r.potential_customers,
      business_model: r.business_model, attractiveness: r.attractiveness, market_size: r.market_size,
      urgency: r.urgency, classification: r.classification, evidence: parseJson<string[]>(r.evidence as string, []),
      confidence: r.confidence,
    })),
    meta: { page: q.page, page_size: q.page_size, total },
  });
});

app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const opp = await db.prepare(`
    SELECT o.*, s.name AS sector_name, s.slug AS sector_slug FROM opportunities o
    LEFT JOIN sectors s ON s.id = o.sector_id WHERE o.slug = ?`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!opp) return c.json({ error: 'not_found' }, 404);
  return c.json({
    data: {
      ...opp,
      existing_alternatives: parseJson<string[]>(opp.existing_alternatives as string, []),
      current_competitors: parseJson<string[]>(opp.current_competitors as string, []),
      technology_required: parseJson<string[]>(opp.technology_required as string, []),
      barriers: parseJson<string[]>(opp.barriers as string, []),
      evidence: parseJson<string[]>(opp.evidence as string, []),
    },
  });
});

export default app;
