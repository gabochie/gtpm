// ============================================================
// GTPM — Company monitoring engine (spec §10 Change Detection)
//
// Captures a snapshot of each organisation's observable state
// (profile fields + counts of tracked joins), diffs it against
// the previous snapshot, and persists both. The diff drives
// the "WHAT CHANGED?" panel on dossier pages.
// ============================================================
import type { D1Database } from '../types-d1';
import { uuid, nowIso } from './utils';

export interface SnapshotState {
  name: string;
  org_type: string;
  description: string | null;
  website: string | null;
  founded_year: number | null;
  funding_status: string | null;
  employee_count: number | null;
  hq_city: string | null;
  sectors: string[];
  technologies: string[];
  products: string[];
  people: number;
  funding_rounds: number;
  funding_total_usd: number;
  signals: number;
  events: number;
  competitors: number;
  partnerships: number;
}

export interface DiffItem {
  field: string;
  from: string;
  to: string;
  label?: string;
}

export interface SnapshotResult {
  organization_id: string;
  state: SnapshotState;
  changes: DiffItem[];
  is_first: boolean;
}

function diffStates(prev: SnapshotState | null, cur: SnapshotState): DiffItem[] {
  if (!prev) return [];
  const changes: DiffItem[] = [];
  const scalarKeys: (keyof SnapshotState)[] = ['name', 'org_type', 'description', 'website', 'founded_year', 'funding_status', 'employee_count', 'hq_city'];
  for (const k of scalarKeys) {
    const a = String(prev[k] ?? '');
    const b = String(cur[k] ?? '');
    if (a !== b) changes.push({ field: k, from: a, to: b });
  }
  const listKeys: { key: keyof SnapshotState; label: string }[] = [
    { key: 'sectors', label: 'sectors' },
    { key: 'technologies', label: 'technologies' },
    { key: 'products', label: 'products' },
  ];
  for (const { key, label } of listKeys) {
    const a = prev[key] as string[];
    const b = cur[key] as string[];
    const added = b.filter((x) => !a.includes(x));
    const removed = a.filter((x) => !b.includes(x));
    if (added.length) changes.push({ field: key, from: '', to: `added: ${added.join(', ')}`, label });
    if (removed.length) changes.push({ field: key, from: `removed: ${removed.join(', ')}`, to: '', label });
  }
  const numKeys: { key: keyof SnapshotState; label: string }[] = [
    { key: 'people', label: 'tracked leaders' },
    { key: 'funding_rounds', label: 'funding rounds' },
    { key: 'funding_total_usd', label: 'total funding' },
    { key: 'signals', label: 'signals' },
    { key: 'events', label: 'events' },
    { key: 'competitors', label: 'competitors' },
    { key: 'partnerships', label: 'partnerships' },
  ];
  for (const { key, label } of numKeys) {
    const a = Number(prev[key] ?? 0);
    const b = Number(cur[key] ?? 0);
    if (a !== b) changes.push({ field: String(key), from: String(a), to: String(b), label });
  }
  return changes;
}

/** Loads the latest snapshot state for an org (if any). */
export async function latestState(db: D1Database, organizationId: string): Promise<SnapshotState | null> {
  const row = await db.prepare(
    `SELECT data FROM company_snapshots WHERE organization_id = ? ORDER BY snapshot_date DESC, created_at DESC LIMIT 1`
  ).bind(organizationId).first<{ data: string }>();
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as SnapshotState;
  } catch {
    return null;
  }
}

/** Builds the current observable state for one organisation. */
export async function buildState(db: D1Database, organizationId: string): Promise<SnapshotState> {
  const org = await db.prepare(
    `SELECT o.name, o.org_type, o.description, o.website, o.founded_year, o.funding_status, o.employee_count,
            l.name AS hq_city
     FROM organizations o LEFT JOIN locations l ON l.id = o.hq_location_id
     WHERE o.id = ?`
  ).bind(organizationId).first<Record<string, unknown>>();
  if (!org) throw new Error(`organisation not found: ${organizationId}`);

  const [sectors, techs, products, people, funding, signals, events, competitors, partnerships] = await Promise.all([
    db.prepare(`SELECT s.name FROM organization_sectors os JOIN sectors s ON s.id = os.sector_id WHERE os.organization_id = ? ORDER BY os.is_primary DESC, s.name`).bind(organizationId).all<{ name: string }>(),
    db.prepare(`SELECT t.name FROM organization_technologies ot JOIN technologies t ON t.id = ot.technology_id WHERE ot.organization_id = ? ORDER BY t.name`).bind(organizationId).all<{ name: string }>(),
    db.prepare(`SELECT name FROM products WHERE organization_id = ? AND status = 'active' ORDER BY name`).bind(organizationId).all<{ name: string }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM organization_people WHERE organization_id = ? AND is_current = 1`).bind(organizationId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS total FROM funding_rounds WHERE organization_id = ?`).bind(organizationId).first<{ n: number; total: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM signals WHERE organization_id = ?`).bind(organizationId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ?`).bind(organizationId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM competitors WHERE organization_id = ?`).bind(organizationId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM partnerships WHERE org_a_id = ?`).bind(organizationId).first<{ n: number }>(),
  ]);

  return {
    name: org.name as string,
    org_type: org.org_type as string,
    description: org.description as string | null,
    website: org.website as string | null,
    founded_year: org.founded_year as number | null,
    funding_status: org.funding_status as string | null,
    employee_count: org.employee_count as number | null,
    hq_city: org.hq_city as string | null,
    sectors: sectors.results.map((r) => r.name),
    technologies: techs.results.map((r) => r.name),
    products: products.results.map((r) => r.name),
    people: Number(people?.n ?? 0),
    funding_rounds: Number(funding?.n ?? 0),
    funding_total_usd: Number(funding?.total ?? 0),
    signals: Number(signals?.n ?? 0),
    events: Number(events?.n ?? 0),
    competitors: Number(competitors?.n ?? 0),
    partnerships: Number(partnerships?.n ?? 0),
  };
}

/** Snapshots one organisation: captures state, diffs vs latest, persists. */
export async function snapshotOrganization(db: D1Database, organizationId: string): Promise<SnapshotResult> {
  const prev = await latestState(db, organizationId);
  const state = await buildState(db, organizationId);
  const changes = diffStates(prev, state);
  await db.prepare(
    `INSERT INTO company_snapshots (id, organization_id, snapshot_date, data, diff_summary, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(uuid(), organizationId, nowIso(), JSON.stringify(state), JSON.stringify(changes), 'company_monitor').run();
  return { organization_id: organizationId, state, changes, is_first: !prev };
}

export interface MonitorRunSummary {
  orgs_snapshotted: number;
  orgs_with_changes: number;
  changes_total: number;
  run_at: string;
}

/** Snapshots every non-private organisation. */
export async function snapshotAllOrganizations(db: D1Database): Promise<MonitorRunSummary> {
  const orgs = await db.prepare(`SELECT id FROM organizations WHERE is_private = 0`).all<{ id: string }>();
  let orgsWithChanges = 0;
  let changesTotal = 0;
  for (const o of orgs.results) {
    const res = await snapshotOrganization(db, o.id);
    if (res.changes.length) {
      orgsWithChanges++;
      changesTotal += res.changes.length;
    }
  }
  return {
    orgs_snapshotted: orgs.results.length,
    orgs_with_changes: orgsWithChanges,
    changes_total: changesTotal,
    run_at: nowIso(),
  };
}
