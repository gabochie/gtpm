// ============================================================
// GTPM — /api/events + /api/signals (spec §10, §11)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseListQuery, parseJson, buildWhere } from '../lib/utils';

// ------------------------------------------------------------
// /api/events
// ------------------------------------------------------------
const eventsApp = new Hono<{ Bindings: { DB: D1Database } }>();

eventsApp.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.type) { params.push(q.type); clauses.push('e.event_type = ?'); }
  const { where } = buildWhere(clauses, params);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM events e ${where}`).bind(...params).first<{ total: number }>();
  const total = totalRow?.total ?? 0;
  const rows = await db.prepare(`
    SELECT e.*, o.name AS org_name, o.slug AS org_slug FROM events e
    LEFT JOIN organizations o ON o.id = e.organization_id
    ${where}
    ORDER BY COALESCE(e.date, '') DESC
    LIMIT ? OFFSET ?`).bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, event_type: r.event_type, title: r.title, description: r.description, date: r.date,
      date_precision: r.date_precision, importance: r.importance,
      metadata: parseJson<Record<string, unknown>>(r.metadata as string, {}),
      organization: r.org_slug ? { slug: r.org_slug, name: r.org_name } : null,
    })),
    meta: { page: q.page, page_size: q.page_size, total },
  });
});

// ------------------------------------------------------------
// /api/signals — competitive signals feed (spec §11)
// ------------------------------------------------------------
const signalsApp = new Hono<{ Bindings: { DB: D1Database } }>();

signalsApp.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.sector) {
    clauses.push(`s.organization_id IN (SELECT organization_id FROM organization_sectors WHERE sector_id = (SELECT id FROM sectors WHERE slug = ?))`);
    params.push(q.sector);
  }
  const { where } = buildWhere(clauses, params);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM signals s ${where}`).bind(...params).first<{ total: number }>();
  const total = totalRow?.total ?? 0;
  const rows = await db.prepare(`
    SELECT s.*, o.name AS org_name, o.slug AS org_slug FROM signals s
    LEFT JOIN organizations o ON o.id = s.organization_id
    ${where}
    ORDER BY s.date DESC
    LIMIT ? OFFSET ?`).bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, signal_type: r.signal_type, title: r.title, description: r.description, importance: r.importance,
      date: r.date, strategic_interpretation: r.strategic_interpretation,
      metadata: parseJson<Record<string, unknown>>(r.metadata as string, {}),
      organization: r.org_slug ? { slug: r.org_slug, name: r.org_name } : null,
    })),
    meta: { page: q.page, page_size: q.page_size, total },
  });
});

// ------------------------------------------------------------
// /api/signals/summary — grouped counts for dashboard
// ------------------------------------------------------------
signalsApp.get('/summary', async (c) => {
  const db = c.env.DB;
  const byType = await db.prepare(`SELECT signal_type, COUNT(*) AS count FROM signals GROUP BY signal_type ORDER BY count DESC`).all<Record<string, unknown>>();
  const byImportance = await db.prepare(`SELECT importance, COUNT(*) AS count FROM signals GROUP BY importance`).all<Record<string, unknown>>();
  return c.json({ data: { by_type: byType.results, by_importance: byImportance.results } });
});

export const events = eventsApp;
export const signals = signalsApp;
