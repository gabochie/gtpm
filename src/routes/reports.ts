// ============================================================
// GTPM — /api/reports (spec §13, §14, §43)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseJson } from '../lib/utils';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

app.get('/', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(`SELECT id, slug, title, report_type, status, generated_at, created_at FROM reports WHERE status = 'published' ORDER BY COALESCE(generated_at, created_at) DESC`).all<Record<string, unknown>>();
  return c.json({ data: rows.results });
});

app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const rep = await db.prepare(`SELECT * FROM reports WHERE slug = ?`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!rep) return c.json({ error: 'not_found' }, 404);
  return c.json({ data: { ...rep, content: parseJson(rep.content as string, {}) } });
});

export default app;
