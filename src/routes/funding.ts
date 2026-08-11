// ============================================================
// GTPM — /api/funding (spec §8 Agent 4)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseListQuery, parseJson, buildWhere } from '../lib/utils';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/funding — funding rounds feed */
app.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.sector) {
    clauses.push(`fr.organization_id IN (SELECT organization_id FROM organization_sectors WHERE sector_id = (SELECT id FROM sectors WHERE slug = ?))`);
    params.push(q.sector);
  }
  const { where } = buildWhere(clauses, params);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM funding_rounds fr ${where}`).bind(...params).first<{ total: number }>();
  const total = totalRow?.total ?? 0;
  const rows = await db.prepare(`
    SELECT fr.*, o.name AS org_name, o.slug AS org_slug, o.org_type
    FROM funding_rounds fr
    JOIN organizations o ON o.id = fr.organization_id
    ${where}
    ORDER BY COALESCE(fr.date, '') DESC
    LIMIT ? OFFSET ?`).bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, round_type: r.round_type, amount_usd: r.amount_usd, amount_original: r.amount_original,
      currency: r.currency, date: r.date, date_precision: r.date_precision,
      investors: parseJson<{ name: string }[]>(r.investors as string, []), lead_investor: r.lead_investor,
      valuation: r.valuation, confidence: r.confidence,
      organization: { slug: r.org_slug, name: r.org_name, org_type: r.org_type },
    })),
    meta: { page: q.page, page_size: q.page_size, total },
  });
});

/** GET /api/funding/stats — sector totals for funding visualisation */
app.get('/stats', async (c) => {
  const db = c.env.DB;
  const bySector = await db.prepare(`
    SELECT s.name AS sector, s.slug AS sector_slug, COALESCE(SUM(fr.amount_usd), 0) AS total_usd, COUNT(fr.id) AS rounds
    FROM funding_rounds fr
    JOIN organization_sectors os ON os.organization_id = fr.organization_id
    JOIN sectors s ON s.id = os.sector_id
    GROUP BY s.id ORDER BY total_usd DESC`).all<Record<string, unknown>>();
  const byYear = await db.prepare(`
    SELECT substr(fr.date, 1, 4) AS year, COALESCE(SUM(fr.amount_usd), 0) AS total_usd, COUNT(*) AS rounds
    FROM funding_rounds fr WHERE fr.date IS NOT NULL
    GROUP BY year ORDER BY year`).all<Record<string, unknown>>();
  const total = await db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS total_usd, COUNT(*) AS rounds FROM funding_rounds`).first<{ total_usd: number; rounds: number }>();
  return c.json({ data: { by_sector: bySector.results, by_year: byYear.results, total_usd: total?.total_usd ?? 0, rounds: total?.rounds ?? 0 } });
});

export default app;
