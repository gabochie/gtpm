// ============================================================
// GTPM — Competitive intelligence scoring engine (spec §9)
//
// Computes 10 transparent dimensions per organisation from
// tracked intelligence. Every score carries:
//   - methodology  (how it was derived)
//   - evidence     (supporting data points)
//   - confidence   (data-availability weighted)
//   - created_at   (when the score was computed)
//
// Scores are deterministic functions of the database — never
// fabricated precision. Rerunning recomputes from live data.
// ============================================================
import type { D1Database, D1PreparedStatement } from '../types-d1';
import { uuid, nowIso } from './utils';

export interface ScoreDraft {
  dimension: string;
  score: number; // 0..100
  methodology: string;
  evidence: string[];
  confidence: number; // 0..1
}

export interface ScoreInput {
  org: {
    id: string;
    slug: string;
    name: string;
    org_type: string;
    funding_status: string | null;
    founded_year: number | null;
    employee_count: number | null;
    confidence: number;
  };
  sectors: { name: string; is_primary: number }[];
  techs: { name: string; adoption_level: string }[];
  products: { name: string; status: string; category: string | null; launch_date: string | null }[];
  people: { title: string | null; is_founder: number }[];
  funding: { amount_usd: number | null; round_type: string; date: string | null }[];
  competitors: { name: string; competition_type: string; strength: number }[];
  partnerships: { name: string }[];
  signals: { title: string; importance: string; date: string }[];
  events: { event_type: string; importance: string; date: string }[];
  // per-sector context for this org's sectors (whitespace / crowding)
  sectorCtx: { name: string; orgs: number; funding_usd: number; signals: number }[];
}

export const DIMENSIONS = [
  'technology_strength', 'market_position', 'growth_momentum', 'funding_strength',
  'talent_strength', 'product_strength', 'ecosystem_influence', 'innovation_velocity',
  'strategic_threat', 'opportunity_attractiveness',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Confidence from evidence volume — more supporting data, higher confidence. */
function dataConfidence(evidenceCount: number, base = 0.35): number {
  return clamp(0.3 + evidenceCount * 0.06, 0.3, 0.95);
}

/** Days since an ISO date (best-effort; missing → null). */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

const ORG_TYPE_BASE: Record<string, number> = {
  bank: 88, telecom: 85, corporation: 82, scaleup: 72, university: 62, research: 60,
  government: 64, regulator: 58, infrastructure: 66, accelerator: 50, incubator: 46,
  venture_fund: 54, startup: 44, ngo: 40, community: 36, media: 42,
};

const ADOPTION_WEIGHT: Record<string, number> = {
  exploring: 0.25, piloting: 0.5, adopted: 0.75, advanced: 1,
};

const COMPETITION_WEIGHT: Record<string, number> = {
  direct: 20, disruptor: 18, global: 15, substitute: 12, indirect: 10, emerging: 8,
};

// ------------------------------------------------------------
// Dimension computations — each returns {score, methodology, evidence}
// ------------------------------------------------------------

function technologyStrength(input: ScoreInput) {
  const evidence = input.techs.map((t) => `${t.name} (${t.adoption_level})`);
  const raw = input.techs.reduce((acc, t) => acc + (ADOPTION_WEIGHT[t.adoption_level] ?? 0.25) * 25, 0);
  return {
    score: round1(clamp(raw)),
    methodology: 'Weighted sum of adopted technologies by adoption level (exploring 25%, piloting 50%, adopted 75%, advanced 100% of 25 pts each), capped at 100.',
    evidence,
    confidence: dataConfidence(evidence.length),
  };
}

function marketPosition(input: ScoreInput) {
  const typeScore = ORG_TYPE_BASE[input.org.org_type] ?? 44;
  const fundingBonus =
    input.org.funding_status === 'series_b' || input.org.funding_status === 'series_c' || input.org.funding_status === 'pe' || input.org.funding_status === 'ipo' ? 20
    : input.org.funding_status === 'series_a' ? 16
    : input.org.funding_status === 'seed' ? 10
    : input.org.funding_status === 'grant' ? 8
    : input.org.funding_status === 'bootstrapped' ? 6 : 0;
  const years = input.org.founded_year ? Math.max(0, Math.min(20, new Date().getFullYear() - input.org.founded_year)) : 0;
  const tenureScore = years * 1.2; // up to 24
  const empScore = input.org.employee_count ? clamp(Math.log10(input.org.employee_count) * 14, 0, 30) : 0;
  const score = clamp(typeScore * 0.45 + fundingBonus + tenureScore + empScore);
  const evidence = [
    `org type: ${input.org.org_type}`,
    ...(input.org.funding_status ? [`funding status: ${input.org.funding_status}`] : []),
    ...(input.org.founded_year ? [`founded ${input.org.founded_year} (${years}y)`] : []),
    ...(input.org.employee_count ? [`${input.org.employee_count} employees`] : []),
  ];
  return {
    score: round1(score),
    methodology: '45% org-type base + funding-status bonus (series_b+ 20, series_a 16, seed 10, grant 8, bootstrapped 6) + 1.2 pts per year of tenure (max 24) + log10(employees)×14 (max 30).',
    evidence,
    confidence: dataConfidence(evidence.length),
  };
}

function growthMomentum(input: ScoreInput) {
  const impWeight = { critical: 3, important: 2, signal: 1 } as Record<string, number>;
  const recentSignals = input.signals.filter((s) => {
    const d = daysSince(s.date);
    return d !== null && d <= 180;
  });
  const recentEvents = input.events.filter((e) => {
    const d = daysSince(e.date);
    return d !== null && d <= 180;
  });
  const sigScore = clamp(recentSignals.reduce((a, s) => a + (impWeight[s.importance] ?? 1), 0) * 12);
  const evScore = clamp(recentEvents.reduce((a, e) => a + (impWeight[e.importance] ?? 1), 0) * 10);
  const score = clamp(sigScore * 0.6 + evScore * 0.4);
  const evidence = [
    ...recentSignals.slice(0, 4).map((s) => `signal: ${s.title}`),
    ...recentEvents.slice(0, 3).map((e) => `event: ${e.event_type}`),
    `${recentSignals.length} signal(s) and ${recentEvents.length} event(s) in the last 180 days`,
  ];
  return {
    score: round1(score),
    methodology: 'Signals & events within 180 days, weighted by importance (critical×3, important×2, signal×1): signals×12 and events×10, blended 60/40.',
    evidence,
    confidence: dataConfidence(recentSignals.length + recentEvents.length),
  };
}

function fundingStrength(input: ScoreInput) {
  const total = input.funding.reduce((a, f) => a + (f.amount_usd ?? 0), 0);
  const amountScore = total > 0 ? clamp(Math.log10(total) / Math.log10(1e8) * 50) : 0; // 0..50 log scale
  const roundsScore = clamp(input.funding.length * 4, 0, 20);
  const latest = input.funding[0]?.date ?? null;
  const latestDays = daysSince(latest);
  const recencyScore = latestDays !== null && latestDays <= 365 ? 15 : latestDays !== null && latestDays <= 730 ? 8 : 0;
  const advancedType = input.funding.some((f) => ['series_a', 'series_b', 'series_c', 'pe', 'ipo'].includes(f.round_type)) ? 15 : 0;
  const score = clamp(amountScore + roundsScore + recencyScore + advancedType);
  const evidence = [
    ...(total > 0 ? [`${Math.round(total).toLocaleString()} USD total tracked`] : []),
    `${input.funding.length} round(s)`,
    ...input.funding.slice(0, 3).map((f) => `${f.round_type}${f.amount_usd ? ` $${Math.round(f.amount_usd).toLocaleString()}` : ''}${f.date ? ` (${f.date})` : ''}`),
    ...(latest && latestDays !== null ? [`latest round ${latestDays}d ago`] : []),
  ];
  return {
    score: round1(score),
    methodology: 'Log-scale total funding (0..50), +4/round (max 20), +15 if latest round within 365d (8 within 730d), +15 if any series/PE/IPO round.',
    evidence,
    confidence: dataConfidence(input.funding.length),
  };
}

function talentStrength(input: ScoreInput) {
  const peopleScore = clamp(input.people.length * 8, 0, 32);
  const founderScore = input.people.some((p) => p.is_founder === 1) ? 22 : 0;
  const execScore = input.people.filter((p) => p.title && /ceo|cto|cfo|coo|chief|president|founder|md/i.test(p.title)).length * 6;
  const empScore = input.org.employee_count ? clamp(Math.log10(input.org.employee_count) * 16, 0, 34) : 0;
  const score = clamp(peopleScore + founderScore + clamp(execScore, 0, 18) + empScore);
  const evidence = [
    `${input.people.length} tracked leader(s)`,
    ...(input.people.some((p) => p.is_founder === 1) ? ['founder(s) identified'] : []),
    ...input.people.slice(0, 4).map((p) => p.title ?? 'leader'),
    ...(input.org.employee_count ? [`${input.org.employee_count} employees`] : []),
  ];
  return {
    score: round1(score),
    methodology: '8 pts per tracked leader (max 32) + 22 if founders identified + 6/executive title (max 18) + log10(employees)×16 (max 34).',
    evidence,
    confidence: dataConfidence(input.people.length),
  };
}

function productStrength(input: ScoreInput) {
  const active = input.products.filter((p) => p.status === 'active').length;
  const beta = input.products.filter((p) => p.status === 'beta').length;
  const cats = new Set(input.products.map((p) => p.category).filter(Boolean)).size;
  const score = clamp(active * 14 + beta * 6 + cats * 6);
  const evidence = [
    `${active} active product(s)${beta ? `, ${beta} in beta` : ''}`,
    ...input.products.slice(0, 5).map((p) => `${p.name} (${p.status}${p.category ? `, ${p.category}` : ''})`),
  ];
  return {
    score: round1(score),
    methodology: '14 pts per active product + 6 per beta + 6 per distinct category, capped at 100.',
    evidence,
    confidence: dataConfidence(input.products.length),
  };
}

function ecosystemInfluence(input: ScoreInput) {
  const partnerScore = clamp(input.partnerships.length * 8, 0, 24);
  const competitorScore = clamp(input.competitors.length * 3, 0, 15);
  const sectorScore = clamp(input.sectors.length * 5, 0, 15);
  const signalScore = clamp(input.signals.length * 2.5, 0, 20);
  const eventScore = clamp(input.events.length * 2, 0, 14);
  const score = clamp(partnerScore + competitorScore + sectorScore + signalScore + eventScore);
  const evidence = [
    `${input.partnerships.length} partnership(s)${input.partnerships.length ? `: ${input.partnerships.slice(0, 3).map((p) => p.name).join(', ')}` : ''}`,
    `${input.competitors.length} mapped competitor(s)`,
    `${input.sectors.length} sector(s)`,
    `${input.signals.length} signal(s), ${input.events.length} event(s)`,
  ];
  return {
    score: round1(score),
    methodology: '8/partnership (max 24) + 3/mapped competitor (max 15) + 5/sector (max 15) + 2.5/signal (max 20) + 2/event (max 14).',
    evidence,
    confidence: dataConfidence(input.partnerships.length + input.competitors.length + input.sectors.length),
  };
}

function innovationVelocity(input: ScoreInput) {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const launches = input.products.filter((p) => p.launch_date && new Date(p.launch_date) >= twoYearsAgo).length;
  const adoptedTech = input.techs.filter((t) => t.adoption_level === 'adopted' || t.adoption_level === 'advanced').length;
  const launchEvents = input.events.filter((e) => ['launch', 'product', 'expansion'].includes(e.event_type) && (daysSince(e.date) ?? 999) <= 730).length;
  const score = clamp(launches * 12 + adoptedTech * 8 + launchEvents * 7);
  const evidence = [
    `${launches} product launch(es) in the last 2 years`,
    `${adoptedTech} adopted/advanced technology(ies)`,
    `${launchEvents} launch/product/expansion event(s) in the last 2 years`,
  ];
  return {
    score: round1(score),
    methodology: '12 per product launch + 8 per adopted/advanced technology + 7 per launch/product/expansion event (all within 2 years).',
    evidence,
    confidence: dataConfidence(launches + adoptedTech + launchEvents),
  };
}

function strategicThreat(input: ScoreInput) {
  let score = 0;
  const detail: string[] = [];
  for (const cmp of input.competitors) {
    const w = COMPETITION_WEIGHT[cmp.competition_type] ?? 8;
    score += w * cmp.strength;
    detail.push(`${cmp.name} (${cmp.competition_type}, strength ${Math.round(cmp.strength * 100)}%)`);
  }
  const crowding = input.sectorCtx.reduce((a, s) => a + Math.max(0, s.orgs - 1), 0);
  const crowdScore = clamp(crowding * 1.5, 0, 20);
  const total = clamp(score * 0.8 + crowdScore);
  const evidence = [
    ...detail.slice(0, 6),
    ...(crowding > 0 ? [`${crowding} competing organisation(s) across ${input.sectors.length} shared sector(s)`] : []),
  ];
  return {
    score: round1(total),
    methodology: 'Competitive pressure = Σ(competition-type weight × strength), where direct 20, disruptor 18, global 15, substitute 12, indirect 10, emerging 8 (×0.8) + 1.5/competing org in shared sectors (max 20). Higher = more competitive pressure faced.',
    evidence,
    confidence: dataConfidence(input.competitors.length + input.sectorCtx.length),
  };
}

function opportunityAttractiveness(input: ScoreInput) {
  const best: { name: string; value: number }[] = [];
  for (const s of input.sectorCtx) {
    const whitespace = Math.max(0, 100 - s.orgs * 6); // fewer orgs → more whitespace
    const fundingPull = clamp(s.funding_usd / 5_000_000, 0, 25); // $5M → 25 pts
    const momentum = clamp(s.signals * 3, 0, 15);
    best.push({ name: s.name, value: clamp(whitespace * 0.6 + fundingPull + momentum) });
  }
  const value = best.length ? Math.max(...best.map((b) => b.value)) : 0;
  const evidence = best.map((b) => `${b.name}: whitespace ${Math.round(b.value)}/100`);
  return {
    score: round1(value),
    methodology: 'For each of the org\'s sectors: whitespace = max(0, 100 − orgs×6) (60%) + funding pull ($5M → 25) + momentum (3/signal, max 15); take the best sector.',
    evidence: evidence.length ? evidence : ['No sector context yet'],
    confidence: dataConfidence(input.sectorCtx.length),
  };
}

// ------------------------------------------------------------
// Entry point: compute all 10 dimensions for one org
// ------------------------------------------------------------
export function computeScores(input: ScoreInput): ScoreDraft[] {
  const fns: Record<Dimension, (i: ScoreInput) => { score: number; methodology: string; evidence: string[]; confidence: number }> = {
    technology_strength: technologyStrength,
    market_position: marketPosition,
    growth_momentum: growthMomentum,
    funding_strength: fundingStrength,
    talent_strength: talentStrength,
    product_strength: productStrength,
    ecosystem_influence: ecosystemInfluence,
    innovation_velocity: innovationVelocity,
    strategic_threat: strategicThreat,
    opportunity_attractiveness: opportunityAttractiveness,
  };
  return DIMENSIONS.map((d) => ({ dimension: d, ...fns[d](input) }));
}

// ------------------------------------------------------------
// DB orchestration: load all org data, compute, persist
// ------------------------------------------------------------
export interface ScoringRunSummary {
  orgs_scored: number;
  dimensions_written: number;
  run_at: string;
}

export async function scoreAllOrganizations(db: D1Database): Promise<ScoringRunSummary> {
  const runAt = nowIso();

  // All non-private orgs
  const orgs = await db.prepare(`
    SELECT id, slug, name, org_type, funding_status, founded_year, employee_count, confidence
    FROM organizations WHERE is_private = 0`).all<Record<string, unknown>>();
  if (!orgs.results.length) return { orgs_scored: 0, dimensions_written: 0, run_at: runAt };

  const ids = orgs.results.map((r) => r.id as string);
  const inIds = ids.map(() => '?').join(',');

  // Bulk load all joins in parallel
  const [secRows, techRows, prodRows, peopleRows, fundRows, compRows, partRows, sigRows, evRows, sectorCounts, sectorFunding, sectorSignals] = await Promise.all([
    db.prepare(`SELECT os.organization_id, s.name, os.is_primary FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id WHERE os.organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT ot.organization_id, t.name, ot.adoption_level FROM organization_technologies ot JOIN technologies t ON t.id = ot.technology_id WHERE ot.organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT organization_id, name, status, category, launch_date FROM products WHERE organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT op.organization_id, op.title, op.is_founder FROM organization_people op WHERE op.organization_id IN (${inIds}) AND op.is_current = 1`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT organization_id, amount_usd, round_type, date FROM funding_rounds WHERE organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT comp.organization_id, co.name, comp.competition_type, comp.strength FROM competitors comp JOIN organizations co ON co.id = comp.competitor_org_id WHERE comp.organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.org_a_id AS organization_id, co.name FROM partnerships p JOIN organizations co ON co.id = p.org_b_id WHERE p.org_a_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT organization_id, title, importance, date FROM signals WHERE organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT organization_id, event_type, importance, date FROM events WHERE organization_id IN (${inIds})`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT sector_id, COUNT(*) AS n FROM organization_sectors GROUP BY sector_id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT os.sector_id, COALESCE(SUM(fr.amount_usd),0) AS total FROM organization_sectors os LEFT JOIN funding_rounds fr ON fr.organization_id = os.organization_id GROUP BY os.sector_id`).all<Record<string, unknown>>(),
    db.prepare(`SELECT os.sector_id, COUNT(si.id) AS n FROM organization_sectors os LEFT JOIN signals si ON si.organization_id = os.organization_id GROUP BY os.sector_id`).all<Record<string, unknown>>(),
  ]);

  const groupByOrg = <T extends Record<string, unknown>>(rows: T[], key: keyof T) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r[key]);
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    return m;
  };
  const sectorsByOrg = groupByOrg(secRows.results, 'organization_id');
  const techsByOrg = groupByOrg(techRows.results, 'organization_id');
  const prodsByOrg = groupByOrg(prodRows.results, 'organization_id');
  const peopleByOrg = groupByOrg(peopleRows.results, 'organization_id');
  const fundsByOrg = groupByOrg(fundRows.results, 'organization_id');
  const compsByOrg = groupByOrg(compRows.results, 'organization_id');
  const partsByOrg = groupByOrg(partRows.results, 'organization_id');
  const sigsByOrg = groupByOrg(sigRows.results, 'organization_id');
  const evsByOrg = groupByOrg(evRows.results, 'organization_id');

  const orgCount = new Map(sectorCounts.results.map((r) => [String(r.sector_id), Number(r.n)]));
  const fundTotal = new Map(sectorFunding.results.map((r) => [String(r.sector_id), Number(r.total)]));
  const sigCount = new Map(sectorSignals.results.map((r) => [String(r.sector_id), Number(r.n)]));

  const statements: D1PreparedStatement[] = [];
  let dimensionsWritten = 0;

  for (const orgRow of orgs.results) {
    const oid = orgRow.id as string;
    const orgSectors = (sectorsByOrg.get(oid) ?? []).map((r) => ({ name: r.name as string, is_primary: Number(r.is_primary) }));
    const input: ScoreInput = {
      org: {
        id: oid, slug: orgRow.slug as string, name: orgRow.name as string,
        org_type: orgRow.org_type as string, funding_status: orgRow.funding_status as string | null,
        founded_year: orgRow.founded_year as number | null, employee_count: orgRow.employee_count as number | null,
        confidence: Number(orgRow.confidence),
      },
      sectors: orgSectors,
      techs: (techsByOrg.get(oid) ?? []).map((r) => ({ name: r.name as string, adoption_level: r.adoption_level as string })),
      products: (prodsByOrg.get(oid) ?? []).map((r) => ({ name: r.name as string, status: r.status as string, category: r.category as string | null, launch_date: r.launch_date as string | null })),
      people: (peopleByOrg.get(oid) ?? []).map((r) => ({ title: r.title as string | null, is_founder: Number(r.is_founder) })),
      funding: (fundsByOrg.get(oid) ?? []).map((r) => ({ amount_usd: r.amount_usd as number | null, round_type: r.round_type as string, date: r.date as string | null })),
      competitors: (compsByOrg.get(oid) ?? []).map((r) => ({ name: r.name as string, competition_type: r.competition_type as string, strength: Number(r.strength) })),
      partnerships: (partsByOrg.get(oid) ?? []).map((r) => ({ name: r.name as string })),
      signals: (sigsByOrg.get(oid) ?? []).map((r) => ({ title: r.title as string, importance: r.importance as string, date: r.date as string })),
      events: (evsByOrg.get(oid) ?? []).map((r) => ({ event_type: r.event_type as string, importance: r.importance as string, date: r.date as string })),
      sectorCtx: orgSectors.map((s) => ({ name: s.name, orgs: 0, funding_usd: 0, signals: 0 })),
    };

    // attach sector context via the org's sector ids
    const orgSectorIds = (secRows.results.filter((r) => r.organization_id === oid)).map((r) => String(r.sector_id));
    input.sectorCtx = orgSectorIds.map((sid, i) => ({
      name: input.sectors[i]?.name ?? sid,
      orgs: orgCount.get(sid) ?? 0,
      funding_usd: fundTotal.get(sid) ?? 0,
      signals: sigCount.get(sid) ?? 0,
    }));

    for (const draft of computeScores(input)) {
      statements.push(
        db.prepare(`INSERT INTO scores (id, organization_id, dimension, score, methodology, evidence, confidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(uuid(), oid, draft.dimension, draft.score, draft.methodology, JSON.stringify(draft.evidence), draft.confidence, runAt)
      );
      dimensionsWritten++;
    }
  }

  // Write in batches to stay within D1 limits
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }

  return { orgs_scored: orgs.results.length, dimensions_written: dimensionsWritten, run_at: runAt };
}
