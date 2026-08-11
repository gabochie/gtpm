// ============================================================
// GTPM — /api/companies routes
// ============================================================
import { Hono } from 'hono';
import type { D1Database } from '../types-d1';
import { parseJson, parseListQuery, buildWhere } from '../lib/utils';
import type {
  CompanyProfile, Organization, Sector, Technology, Location,
  Product, Person, FundingRound, Competitor, Partnership, EventItem,
  Signal, Score, CompanyTimelineItem,
} from '../types';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

// Row mappers
const orgFromRow = (r: Record<string, unknown>): Organization => ({
  id: r.id as string, slug: r.slug as string, name: r.name as string,
  legal_name: r.legal_name as string | null, org_type: r.org_type as Organization['org_type'],
  description: r.description as string | null, overview: r.overview as string | null,
  founded_year: r.founded_year as number | null, hq_location_id: r.hq_location_id as string | null,
  website: r.website as string | null, socials: parseJson<Record<string, string>>(r.socials as string, {}),
  email: r.email as string | null, employee_count: r.employee_count as number | null,
  funding_status: r.funding_status as string | null, status: r.status as Organization['status'],
  verification_status: r.verification_status as Organization['verification_status'],
  confidence: r.confidence as number, last_verified: r.last_verified as string | null,
  last_checked: r.last_checked as string | null, next_check: r.next_check as string | null,
  monitor_frequency: r.monitor_frequency as Organization['monitor_frequency'],
  is_private: r.is_private as number, is_seed: r.is_seed as number,
  created_at: r.created_at as string, updated_at: r.updated_at as string,
});

const COMPANY_SELECT = `
  SELECT o.*, l.name AS hq_city, l.lat AS hq_lat, l.lng AS hq_lng,
    (SELECT COUNT(*) FROM organization_sectors os WHERE os.organization_id = o.id) AS sector_count
  FROM organizations o
  LEFT JOIN locations l ON l.id = o.hq_location_id`;

/** GET /api/companies — list with filters */
app.get('/', async (c) => {
  const db = c.env.DB;
  const q = parseListQuery(c.req.query());
  const clauses: string[] = ['o.is_private = 0'];
  const params: unknown[] = [];

  if (q.type) { params.push(q.type); clauses.push('o.org_type = ?'); }
  if (q.location) { params.push(q.location); clauses.push('l.slug = ?'); }
  if (q.q) {
    const like = `%${q.q}%`;
    params.push(like, like, like);
    clauses.push('(o.name LIKE ? OR o.description LIKE ? OR o.overview LIKE ?)');
  }
  if (q.sector) {
    clauses.push('o.id IN (SELECT organization_id FROM organization_sectors WHERE sector_id = (SELECT id FROM sectors WHERE slug = ?))');
    params.push(q.sector);
  }
  const { where } = buildWhere(clauses, params);

  const sortMap: Record<string, string> = {
    name: 'o.name ASC', founded: 'o.founded_year DESC', newest: 'o.created_at DESC', confidence: 'o.confidence DESC',
  };
  const orderBy = sortMap[q.sort ?? ''] ?? 'o.name ASC';

  const row = await db.prepare(`SELECT COUNT(*) AS total FROM organizations o LEFT JOIN locations l ON l.id = o.hq_location_id ${where}`).bind(...params).first<{ total: number }>();
  const total = row?.total ?? 0;
  const rows = await db.prepare(`${COMPANY_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...params, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();

  // attach primary sector + tech count per org (batch)
  const orgIds = rows.results.map((r) => r.id as string);
  const orgs = rows.results.map(orgFromRow);
  const sectorMap = new Map<string, Sector[]>();
  const techMap = new Map<string, Technology[]>();
  if (orgIds.length) {
    const secRows = await db.prepare(`
      SELECT os.organization_id, s.id, s.slug, s.name, os.is_primary
      FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id
      WHERE os.organization_id IN (${orgIds.map(() => '?').join(',')})`).bind(...orgIds).all<Record<string, unknown>>();
    for (const r of secRows.results) {
      const list = sectorMap.get(r.organization_id as string) ?? [];
      list.push({ id: r.id as string, slug: r.slug as string, name: r.name as string, parent_id: null, description: null, sort_order: 0, is_primary: r.is_primary as number });
      sectorMap.set(r.organization_id as string, list);
    }
    const techRows = await db.prepare(`
      SELECT ot.organization_id, t.id, t.slug, t.name, t.lifecycle, t.radar_ring, t.trend_score, ot.adoption_level
      FROM organization_technologies ot JOIN technologies t ON t.id = ot.technology_id
      WHERE ot.organization_id IN (${orgIds.map(() => '?').join(',')})`).bind(...orgIds).all<Record<string, unknown>>();
    for (const r of techRows.results) {
      const list = techMap.get(r.organization_id as string) ?? [];
      list.push({ id: r.id as string, slug: r.slug as string, name: r.name as string, description: null, lifecycle: r.lifecycle as Technology['lifecycle'], radar_ring: r.radar_ring as Technology['radar_ring'], trend_score: r.trend_score as number | null });
      techMap.set(r.organization_id as string, list);
    }
  }

  const data = orgs.map((o, i) => ({
    ...o, hq_city: rows.results[i]?.hq_city as string | null,
    hq_lat: rows.results[i]?.hq_lat as number | null, hq_lng: rows.results[i]?.hq_lng as number | null,
    sectors: sectorMap.get(o.id) ?? [], technologies: techMap.get(o.id) ?? [],
  }));

  return c.json({ data, meta: { page: q.page, page_size: q.page_size, total } });
});

/** GET /api/companies/:slug — full intelligence profile */
app.get('/:slug', async (c) => {
  const db = c.env.DB;
  const orgRow = await db.prepare(`${COMPANY_SELECT} WHERE o.slug = ? AND o.is_private = 0`).bind(c.req.param('slug')).first<Record<string, unknown>>();
  if (!orgRow) return c.json({ error: 'not_found', message: 'Organization not found' }, 404);

  const oid = orgRow.id as string;
  const org = orgFromRow(orgRow);

  const [sectors, technologies, location, products, people, funding, competitors, partnerships, events, signals, scores] = await Promise.all([
    db.prepare(`SELECT s.id, s.slug, s.name, s.description FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id WHERE os.organization_id = ? ORDER BY os.is_primary DESC`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.id, t.slug, t.name, t.description, t.lifecycle, t.radar_ring, t.trend_score FROM organization_technologies ot JOIN technologies t ON t.id = ot.technology_id WHERE ot.organization_id = ?`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM locations WHERE id = ?`).bind(org.hq_location_id).first<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM products WHERE organization_id = ? ORDER BY status = 'active' DESC, name`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.*, op.role AS org_role, op.is_founder FROM organization_people op JOIN people p ON p.id = op.person_id WHERE op.organization_id = ? AND op.is_current = 1`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT fr.* FROM funding_rounds fr WHERE fr.organization_id = ? ORDER BY fr.date DESC`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT comp.*, co.name AS competitor_name, co.slug AS competitor_slug, co.org_type AS competitor_type FROM competitors comp JOIN organizations co ON co.id = comp.competitor_org_id WHERE comp.organization_id = ?`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.*, co.name AS partner_name, co.slug AS partner_slug, co.org_type AS partner_type FROM partnerships p JOIN organizations co ON co.id = p.org_b_id WHERE p.org_a_id = ?`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM events WHERE organization_id = ? ORDER BY date DESC LIMIT 30`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM signals WHERE organization_id = ? ORDER BY date DESC LIMIT 30`).bind(oid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM scores WHERE organization_id = ? ORDER BY created_at DESC`).bind(oid).all<Record<string, unknown>>(),
  ]);

  // funding totals
  const totals = await db.prepare(`SELECT SUM(amount_usd) AS total_usd, COUNT(*) AS rounds FROM funding_rounds WHERE organization_id = ?`).bind(oid).first<{ total_usd: number | null; rounds: number }>();
  const latestFunding = funding.results[0] as Record<string, unknown> | undefined;

  // sources for this org (via claims/signals/events — light version: org-level sources)
  const sources = await db.prepare(`
    SELECT DISTINCT s.* FROM sources s
    WHERE s.id IN (SELECT source_id FROM funding_rounds WHERE organization_id = ?)
       OR s.id IN (SELECT source_id FROM signals WHERE organization_id = ?)
    LIMIT 10`).bind(oid, oid).all<Record<string, unknown>>();

  // timeline: founded + funding + events (+ signals)
  const timeline: CompanyTimelineItem[] = [];
  if (org.founded_year) {
    timeline.push({ date: `${org.founded_year}`, date_precision: 'year', type: 'founded', title: 'Founded', description: `${org.name} was founded.`, importance: 'important' });
  }
  for (const f of funding.results) {
    timeline.push({ date: f.date as string | null, date_precision: f.date_precision as CompanyTimelineItem['date_precision'], type: 'funding', title: `${String(f.round_type).toUpperCase()} round`, description: f.notes as string | null, importance: 'important' });
  }
  for (const e of events.results) {
    timeline.push({ date: e.date as string | null, date_precision: e.date_precision as CompanyTimelineItem['date_precision'], type: e.event_type as CompanyTimelineItem['type'], title: e.title as string, description: e.description as string | null, importance: e.importance as CompanyTimelineItem['importance'] });
  }
  timeline.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const profile: CompanyProfile = {
    ...org,
    hq_location: location ? {
      id: location.id as string, slug: location.slug as string, name: location.name as string,
      type: location.type as Location['type'], parent_id: location.parent_id as string | null,
      country_code: location.country_code as string, lat: location.lat as number | null,
      lng: location.lng as number | null, is_capital: location.is_capital as number,
    } : null,
    sectors: sectors.results.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string, description: r.description as string | null, parent_id: null, sort_order: 0 })),
    technologies: technologies.results.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string, description: r.description as string | null, lifecycle: r.lifecycle as Technology['lifecycle'], radar_ring: r.radar_ring as Technology['radar_ring'], trend_score: r.trend_score as number | null })),
    products: products.results.map((r) => ({
      id: r.id as string, slug: r.slug as string, organization_id: r.organization_id as string,
      name: r.name as string, description: r.description as string | null, category: r.category as string | null,
      target_users: r.target_users as string | null, business_model: r.business_model as string | null,
      pricing: r.pricing as string | null, technology: parseJson<string[]>(r.technology as string, []),
      launch_date: r.launch_date as string | null, status: r.status as Product['status'], url: r.url as string | null,
    })),
    people: people.results.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string, role: r.role as Person['role'], title: (r.org_role ?? r.title) as string | null, bio: r.bio as string | null, location_id: r.location_id as string | null, linkedin: r.linkedin as string | null, twitter: r.twitter as string | null, website: r.website as string | null, image_url: r.image_url as string | null, verification_status: r.verification_status as Person['verification_status'], confidence: r.confidence as number })),
    funding: funding.results.map((r) => ({ id: r.id as string, organization_id: r.organization_id as string, round_type: r.round_type as FundingRound['round_type'], amount_usd: r.amount_usd as number | null, amount_original: r.amount_original as number | null, currency: r.currency as string | null, date: r.date as string | null, date_precision: r.date_precision as FundingRound['date_precision'], investors: parseJson<{ name: string }[]>(r.investors as string, []), lead_investor: r.lead_investor as string | null, valuation: r.valuation as string | null, notes: r.notes as string | null, source_id: r.source_id as string | null, confidence: r.confidence as number })),
    competitors: competitors.results.map((r) => ({ id: r.id as string, organization_id: r.organization_id as string, competitor_org_id: r.competitor_org_id as string, competition_type: r.competition_type as Competitor['competition_type'], strength: r.strength as number, evidence: r.evidence as string | null, competitor: r.competitor_name ? { slug: r.competitor_slug as string, name: r.competitor_name as string, org_type: r.competitor_type as Organization['org_type'], description: null } : undefined })),
    partnerships: partnerships.results.map((r) => ({ id: r.id as string, org_a_id: r.org_a_id as string, org_b_id: r.org_b_id as string, partnership_type: r.partnership_type as string, description: r.description as string | null, date: r.date as string | null, status: r.status as string, partner: r.partner_name ? { slug: r.partner_slug as string, name: r.partner_name as string, org_type: r.partner_type as Organization['org_type'] } : undefined })),
    events: events.results.map((r) => ({ id: r.id as string, organization_id: r.organization_id as string | null, event_type: r.event_type as string, title: r.title as string, description: r.description as string | null, date: r.date as string | null, date_precision: r.date_precision as EventItem['date_precision'], importance: r.importance as EventItem['importance'], metadata: parseJson<Record<string, unknown>>(r.metadata as string, {}), source_id: r.source_id as string | null })),
    signals: signals.results.map((r) => ({ id: r.id as string, organization_id: r.organization_id as string | null, signal_type: r.signal_type as string, title: r.title as string, description: r.description as string | null, importance: r.importance as Signal['importance'], date: r.date as string, strategic_interpretation: r.strategic_interpretation as string | null, source_id: r.source_id as string | null, claim_id: r.claim_id as string | null, metadata: parseJson<Record<string, unknown>>(r.metadata as string, {}) })),
    scores: scores.results.map((r) => ({ id: r.id as string, organization_id: r.organization_id as string, dimension: r.dimension as string, score: r.score as number, methodology: r.methodology as string | null, evidence: parseJson<string[]>(r.evidence as string, []), confidence: r.confidence as number, created_at: r.created_at as string })),
    timeline,
    total_funding_usd: totals?.total_usd ?? null,
    latest_funding: latestFunding ? { id: latestFunding.id as string, organization_id: latestFunding.organization_id as string, round_type: latestFunding.round_type as FundingRound['round_type'], amount_usd: latestFunding.amount_usd as number | null, amount_original: latestFunding.amount_original as number | null, currency: latestFunding.currency as string | null, date: latestFunding.date as string | null, date_precision: latestFunding.date_precision as FundingRound['date_precision'], investors: parseJson<{ name: string }[]>(latestFunding.investors as string, []), lead_investor: latestFunding.lead_investor as string | null, valuation: latestFunding.valuation as string | null, notes: latestFunding.notes as string | null, source_id: latestFunding.source_id as string | null, confidence: latestFunding.confidence as number } : null,
    sources: sources.results.map((r) => ({ id: r.id as string, url: r.url as string | null, title: r.title as string, publisher: r.publisher as string | null, source_type: r.source_type as string, reliability: r.reliability as number, robots_allowed: r.robots_allowed as number, fetch_frequency: r.fetch_frequency as string, last_fetched: r.last_fetched as string | null, next_fetch: r.next_fetch as string | null, fetch_status: r.fetch_status as string })),
  };

  return c.json({ data: profile });
});

/** GET /api/companies/:slug/timeline */
app.get('/:slug/timeline', async (c) => {
  const db = c.env.DB;
  const org = await db.prepare(`SELECT id FROM organizations WHERE slug = ?`).bind(c.req.param('slug')).first<{ id: string }>();
  if (!org) return c.json({ error: 'not_found' }, 404);
  const [funding, events, signals, snapshots] = await Promise.all([
    db.prepare(`SELECT date, round_type AS type, notes AS description FROM funding_rounds WHERE organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`SELECT date, event_type AS type, title, description, importance FROM events WHERE organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`SELECT date, signal_type AS type, title, description, importance FROM signals WHERE organization_id = ?`).bind(org.id).all<Record<string, unknown>>(),
    db.prepare(`SELECT snapshot_date AS date, diff_summary FROM company_snapshots WHERE organization_id = ? ORDER BY snapshot_date DESC LIMIT 20`).bind(org.id).all<Record<string, unknown>>(),
  ]);
  const items = [...funding.results, ...events.results, ...signals.results].sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return c.json({ data: items, snapshots: snapshots.results });
});

/** GET /api/companies/compare?ids=slug1,slug2,slug3 (up to 5) */
app.get('/compare', async (c) => {
  const db = c.env.DB;
  const slugs = (c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (slugs.length < 2) return c.json({ error: 'Provide at least 2 slugs via ?ids=a,b' }, 400);
  const rows = await db.prepare(`${COMPANY_SELECT} WHERE o.slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all<Record<string, unknown>>();
  const out = [];
  for (const r of rows.results) {
    const oid = r.id as string;
    const [funding, sectors, competitors] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(amount_usd),0) AS total, COUNT(*) AS rounds FROM funding_rounds WHERE organization_id = ?`).bind(oid).first<{ total: number; rounds: number }>(),
      db.prepare(`SELECT s.name FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id WHERE os.organization_id = ?`).bind(oid).all<{ name: string }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM competitors WHERE organization_id = ?`).bind(oid).first<{ n: number }>(),
    ]);
    out.push({
      slug: r.slug, name: r.name, org_type: r.org_type, description: r.description,
      founded_year: r.founded_year, website: r.website, hq_city: r.hq_city,
      funding_total_usd: funding?.total ?? 0, funding_rounds: funding?.rounds ?? 0,
      competitor_count: competitors?.n ?? 0,
      sectors: sectors.results.map((s) => s.name),
      verification_status: r.verification_status, confidence: r.confidence,
    });
  }
  return c.json({ data: out });
});

export default app;
