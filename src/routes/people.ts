// ============================================================
// GTPM — /api/people
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseListQuery, buildWhere } from '../lib/utils';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/people — founders, executives, investors, researchers */
app.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.q) {
    const like = `%${q.q}%`;
    params.push(like, like);
    clauses.push('(p.name LIKE ? OR p.bio LIKE ?)');
  }
  if (q.type) { params.push(q.type); clauses.push('p.role = ?'); }
  const { where } = buildWhere(clauses, params);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM people p ${where}`).bind(...params).first<{ total: number }>();
  const total = totalRow?.total ?? 0;
  const rows = await db.prepare(`
    SELECT p.*, GROUP_CONCAT(o.name, ' || ') AS org_names, GROUP_CONCAT(o.slug, ' || ') AS org_slugs,
      GROUP_CONCAT(op.role, ' || ') AS org_roles
    FROM people p
    LEFT JOIN organization_people op ON op.person_id = p.id AND op.is_current = 1
    LEFT JOIN organizations o ON o.id = op.organization_id
    ${where}
    GROUP BY p.id
    ORDER BY p.name
    LIMIT ? OFFSET ?`).bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, role: r.role, title: r.title, bio: r.bio,
      linkedin: r.linkedin, twitter: r.twitter, website: r.website, verification_status: r.verification_status,
      organizations: r.org_names ? String(r.org_names).split(' || ').map((name, i) => ({ name, slug: String(r.org_slugs).split(' || ')[i], role: String(r.org_roles).split(' || ')[i] })) : [],
    })),
    meta: { page: q.page, page_size: q.page_size, total },
  });
});

/** GET /api/people/:slug */
app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const person = await db.prepare(`SELECT * FROM people WHERE slug = ?`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!person) return c.json({ error: 'not_found' }, 404);
  const orgs = await db.prepare(`
    SELECT o.id, o.slug, o.name, o.org_type, op.role, op.title, op.is_founder, op.start_date, op.end_date
    FROM organization_people op JOIN organizations o ON o.id = op.organization_id
    WHERE op.person_id = ? ORDER BY op.is_current DESC, op.start_date DESC`).bind(person.id).all<Record<string, unknown>>();
  return c.json({ data: { ...person, organizations: orgs.results } });
});

export default app;
