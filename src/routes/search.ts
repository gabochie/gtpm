// ============================================================
// GTPM — /api/search (spec §29 global natural-language search)
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

/** GET /api/search?q=...&type=... — hybrid FTS + keyword search */
app.get('/', async (c) => {
  const db = c.env.DB;
  const raw = (c.req.query('q') ?? '').trim();
  const type = c.req.query('type');
  const limit = Math.min(50, parseInt(c.req.query('limit') ?? '20', 10) || 20);
  if (!raw) return c.json({ data: [], meta: { q: '' } });

  // tokenise: drop common English stopwords, keep meaningful terms
  const stopwords = new Set(['who','what','are','is','the','a','an','of','in','on','to','for','and','or','with','ghana','ghanaian','which','that','companies','company','strongest','using','building','do','does','did','have','has','their','them','they','where','how','why','best','top','biggest','list']);
  const terms = raw.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !stopwords.has(t));
  const matchTerms = terms.length ? terms : [raw.toLowerCase()];

  // FTS5 query (prefix match)
  const ftsQuery = matchTerms.map((t) => `${t}*`).join(' AND ');
  let results: Record<string, unknown>[] = [];
  try {
    const fts = await db.prepare(`
      SELECT f.entity_type, f.entity_id, f.name, f.body, bm25(search_fts) AS rank
      FROM search_fts f WHERE search_fts MATCH ? ORDER BY rank LIMIT ?`).bind(ftsQuery, limit).all<Record<string, unknown>>();
    results = fts.results;
  } catch {
    // FTS syntax edge cases → fall back to LIKE
    const like = matchTerms.map((t) => `%${t}%`).join(' ');
    const fts = await db.prepare(`SELECT entity_type, entity_id, name, body, 0 AS rank FROM search_fts WHERE name LIKE ? OR body LIKE ? LIMIT ?`)
      .bind(`%${matchTerms[0]}%`, `%${matchTerms[0]}%`, limit).all<Record<string, unknown>>();
    results = fts.results;
  }

  // enrich results with entity slugs
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    const et = r.entity_type as string;
    const eid = r.entity_id as string;
    let slug = null;
    let extra: Record<string, unknown> | null = null;
    if (et === 'organization') {
      const row = await db.prepare(`SELECT slug, org_type, description FROM organizations WHERE id = ? AND is_private = 0`).bind(eid).first<Record<string, unknown>>();
      if (row) { slug = row.slug; extra = { org_type: row.org_type, description: row.description }; }
    } else if (et === 'person') {
      const row = await db.prepare(`SELECT slug, title FROM people WHERE id = ?`).bind(eid).first<Record<string, unknown>>();
      if (row) { slug = row.slug; extra = { title: row.title }; }
    } else if (et === 'product') {
      const row = await db.prepare(`SELECT slug FROM products WHERE id = ?`).bind(eid).first<Record<string, unknown>>();
      if (row) slug = row.slug;
    }
    if (slug) out.push({ entity_type: et, entity_id: eid, slug, name: r.name, snippet: String(r.body ?? '').slice(0, 220), ...extra });
  }

  // detect intent for structured answer (facts + strategic interpretation separation)
  const intent = detectIntent(raw, matchTerms);

  return c.json({
    data: out,
    meta: { q: raw, terms: matchTerms, intent, generated_at: new Date().toISOString() },
  });
});

function detectIntent(raw: string, terms: string[]): { kind: string; sector?: string } | null {
  const lower = raw.toLowerCase();
  if (/(competes|competitor|rival|vs\.?|versus)/.test(lower)) return { kind: 'competitors' };
  if (/(opportunit|gap|white space|underserved)/.test(lower)) return { kind: 'opportunities' };
  if (/(fund|raised|investor|financ)/.test(lower)) return { kind: 'funding' };
  if (/(hir|job|talent)/.test(lower)) return { kind: 'talent' };
  if (/(changed|new|latest|recent|this month)/.test(lower)) return { kind: 'changes' };
  if (/(ai agent|artificial intelligence|machine learning)/.test(lower)) return { kind: 'technology', sector: 'Artificial Intelligence' };
  if (/(fintech|payment|mobile money)/.test(lower)) return { kind: 'sector', sector: 'Fintech' };
  if (/(construction|aec|building|contech)/.test(lower)) return { kind: 'sector', sector: 'ConTech' };
  if (/(agric|farm)/.test(lower)) return { kind: 'sector', sector: 'Agritech' };
  if (/(health|medical)/.test(lower)) return { kind: 'sector', sector: 'HealthTech' };
  if (/(cyber|security)/.test(lower)) return { kind: 'sector', sector: 'Cybersecurity' };
  return null;
}

export default app;
