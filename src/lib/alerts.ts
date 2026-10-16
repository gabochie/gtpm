// ============================================================
// GTPM — Alerts engine (spec §11 Competitive Alerts)
//
// Users follow entities (organization | sector | technology |
// person | market). When signals/events are created, alerts
// fan out to every follower of the entity and its context
// (org → its sectors + technologies + market). Following also
// backfills alerts from the last 30 days so feeds start full.
// ============================================================
import type { D1Database } from '../types-d1';
import { uuid, nowIso } from './utils';

export type WatchEntityType = 'organization' | 'sector' | 'technology' | 'person' | 'market';

export const WATCH_TYPES: WatchEntityType[] = ['organization', 'sector', 'technology', 'person', 'market'];

const DAY_MS = 86_400_000;
const BACKFILL_WINDOW_DAYS = 30;

/** Creates the anonymous user row on first use (Phase 4 auth replaces this). */
export async function ensureUser(db: D1Database, userId: string): Promise<void> {
  const existing = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first<{ id: string }>();
  if (existing) return;
  // OR IGNORE: concurrent first-use calls can race past the SELECT — the loser must not hit the UNIQUE constraint.
  await db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, is_private, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'subscriber', 0, ?, ?)`
  ).bind(userId, `anon-${userId}@gtpm.local`, 'anon-device', 'Anonymous device', nowIso(), nowIso()).run();
}

export async function isFollowing(db: D1Database, userId: string, entityType: string, entityId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS n FROM watchlists WHERE user_id = ? AND entity_type = ? AND entity_id = ?`
  ).bind(userId, entityType, entityId).first<{ n: number }>();
  return !!row;
}

export interface FollowResult {
  created: boolean;
  backfilled: number;
}

export async function follow(db: D1Database, userId: string, entityType: WatchEntityType, entityId: string): Promise<FollowResult> {
  await ensureUser(db, userId);
  if (await isFollowing(db, userId, entityType, entityId)) return { created: false, backfilled: 0 };
  await db.prepare(
    `INSERT INTO watchlists (id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(uuid(), userId, entityType, entityId, nowIso()).run();
  const backfilled = await backfillForFollow(db, userId, entityType, entityId);
  return { created: true, backfilled };
}

export async function unfollow(db: D1Database, userId: string, entityType: string, entityId: string): Promise<boolean> {
  const res = await db.prepare(
    `DELETE FROM watchlists WHERE user_id = ? AND entity_type = ? AND entity_id = ?`
  ).bind(userId, entityType, entityId).run();
  return res.success;
}

export interface FollowRow {
  entity_type: WatchEntityType;
  entity_id: string;
  entity_name: string | null;
  created_at: string;
}

export async function listFollows(db: D1Database, userId: string): Promise<FollowRow[]> {
  await ensureUser(db, userId);
  const rows = await db.prepare(`SELECT entity_type, entity_id, created_at FROM watchlists WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId).all<{ entity_type: string; entity_id: string; created_at: string }>();
  const names = await entityNames(db, rows.results);
  return rows.results.map((r) => ({
    entity_type: r.entity_type as WatchEntityType,
    entity_id: r.entity_id as string,
    entity_name: names.get(`${r.entity_type}:${r.entity_id}`) ?? null,
    created_at: r.created_at as string,
  }));
}

/** Resolves display names for watchlist entries. */
async function entityNames(db: D1Database, rows: { entity_type: string; entity_id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byType.get(r.entity_type) ?? new Set();
    set.add(r.entity_id);
    byType.set(r.entity_type, set);
  }
  for (const [type, ids] of byType) {
    const table = type === 'organization' ? 'organizations' : type === 'sector' ? 'sectors' : type === 'technology' ? 'technologies' : type === 'person' ? 'people' : null;
    if (!table || type === 'market') {
      if (type === 'market') for (const id of ids) out.set(`market:${id}`, id === 'GH' ? 'Ghana tech market' : id);
      continue;
    }
    const inIds = [...ids].map(() => '?').join(',');
    const res = await db.prepare(`SELECT id, name FROM ${table} WHERE id IN (${inIds})`).bind(...ids).all<{ id: string; name: string }>();
    for (const row of res.results) out.set(`${type}:${row.id}`, row.name);
  }
  return out;
}

// ------------------------------------------------------------
// Alert generation
// ------------------------------------------------------------

interface SignalLike {
  id: string;
  organization_id: string | null;
  title: string;
  signal_type: string;
  importance: string;
  date: string;
  description: string | null;
  strategic_interpretation: string | null;
}

interface EventLike {
  id: string;
  organization_id: string | null;
  title: string;
  event_type: string;
  importance: string;
  date: string;
  description: string | null;
}

/** Users following a context: the org itself, its sectors/technologies, or the market. */
async function contextFollowers(db: D1Database, orgId: string): Promise<{ user_id: string; entity_type: string; entity_id: string }[]> {
  const [sectors, techs, people] = await Promise.all([
    db.prepare(`SELECT sector_id FROM organization_sectors WHERE organization_id = ?`).bind(orgId).all<{ sector_id: string }>(),
    db.prepare(`SELECT technology_id FROM organization_technologies WHERE organization_id = ?`).bind(orgId).all<{ technology_id: string }>(),
    db.prepare(`SELECT person_id FROM organization_people WHERE organization_id = ? AND is_current = 1`).bind(orgId).all<{ person_id: string }>(),
  ]);
  const sectorIds = sectors.results.map((r) => r.sector_id);
  const techIds = techs.results.map((r) => r.technology_id);
  const personIds = people.results.map((r) => r.person_id);
  const clauses = [`entity_type = 'organization' AND entity_id = ?`];
  const params: unknown[] = [orgId];
  if (sectorIds.length) {
    clauses.push(`entity_type = 'sector' AND entity_id IN (${sectorIds.map(() => '?').join(',')})`);
    params.push(...sectorIds);
  }
  if (techIds.length) {
    clauses.push(`entity_type = 'technology' AND entity_id IN (${techIds.map(() => '?').join(',')})`);
    params.push(...techIds);
  }
  if (personIds.length) {
    clauses.push(`entity_type = 'person' AND entity_id IN (${personIds.map(() => '?').join(',')})`);
    params.push(...personIds);
  }
  clauses.push(`entity_type = 'market' AND entity_id = 'GH'`);
  const rows = await db.prepare(`SELECT user_id, entity_type, entity_id FROM watchlists WHERE ${clauses.join(' OR ')}`)
    .bind(...params).all<{ user_id: string; entity_type: string; entity_id: string }>();
  return rows.results;
}

/** Inserts one alert if the same (entity, alert_type, title) isn't already present for that user. */
async function insertAlertIfNew(db: D1Database, userId: string, entityType: string, entityId: string, alertType: string, title: string, body: string | null, importance: string): Promise<void> {
  const dup = await db.prepare(
    `SELECT 1 AS n FROM alerts WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND alert_type = ? AND title = ?`
  ).bind(userId, entityType, entityId, alertType, title).first<{ n: number }>();
  if (dup) return;
  await db.prepare(
    `INSERT INTO alerts (id, user_id, entity_type, entity_id, alert_type, title, body, importance, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(uuid(), userId, entityType, entityId, alertType, title, body, importance, nowIso()).run();
}

/** Fans a new signal out to everyone watching the org, its context, or the market. */
export async function fanoutSignal(db: D1Database, signal: SignalLike): Promise<number> {
  if (!signal.organization_id) return 0;
  const followers = await contextFollowers(db, signal.organization_id);
  const body = signal.strategic_interpretation ?? signal.description ?? null;
  let created = 0;
  for (const f of followers) {
    const before = await unreadCount(db, f.user_id);
    await insertAlertIfNew(db, f.user_id, f.entity_type, f.entity_id, signal.signal_type || 'signal', signal.title, body, signal.importance);
    const after = await unreadCount(db, f.user_id);
    if (after > before) created++;
  }
  return created;
}

/** Fans a new event out (same rule as signals). */
export async function fanoutEvent(db: D1Database, event: EventLike): Promise<number> {
  if (!event.organization_id) return 0;
  const followers = await contextFollowers(db, event.organization_id);
  let created = 0;
  for (const f of followers) {
    const before = await unreadCount(db, f.user_id);
    await insertAlertIfNew(db, f.user_id, f.entity_type, f.entity_id, event.event_type || 'event', event.title, event.description, event.importance);
    const after = await unreadCount(db, f.user_id);
    if (after > before) created++;
  }
  return created;
}

/**
 * Backfills alerts for a freshly-added follow from the last 30 days.
 * Uses a synthetic id so the dedupe key is unique per follow — the
 * same signal can alert two different follows of the same entity
 * only when both pre-date this follow.
 */
export async function backfillForFollow(db: D1Database, userId: string, entityType: WatchEntityType, entityId: string): Promise<number> {
  const since = new Date(Date.now() - BACKFILL_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  let candidates: { alert_type: string; title: string; body: string | null; importance: string }[] = [];

  if (entityType === 'organization') {
    const sig = await db.prepare(
      `SELECT signal_type, title, COALESCE(strategic_interpretation, description) AS body, importance
       FROM signals WHERE organization_id = ? AND date >= ? ORDER BY date DESC LIMIT 20`
    ).bind(entityId, since).all<Record<string, unknown>>();
    const ev = await db.prepare(
      `SELECT event_type, title, description AS body, importance
       FROM events WHERE organization_id = ? AND date >= ? ORDER BY date DESC LIMIT 20`
    ).bind(entityId, since).all<Record<string, unknown>>();
    candidates = [...sig.results, ...ev.results].map((r) => ({
      alert_type: (r.signal_type ?? r.event_type ?? 'alert') as string,
      title: r.title as string,
      body: r.body as string | null,
      importance: r.importance as string,
    }));
  } else if (entityType === 'sector') {
    const rows = await db.prepare(
      `SELECT s.signal_type, s.title, COALESCE(s.strategic_interpretation, s.description) AS body, s.importance
       FROM signals s JOIN organization_sectors os ON os.organization_id = s.organization_id
       WHERE os.sector_id = ? AND s.date >= ? ORDER BY s.date DESC LIMIT 20`
    ).bind(entityId, since).all<Record<string, unknown>>();
    candidates = rows.results.map((r) => ({ alert_type: r.signal_type as string, title: r.title as string, body: r.body as string | null, importance: r.importance as string }));
  } else if (entityType === 'technology') {
    const rows = await db.prepare(
      `SELECT s.signal_type, s.title, COALESCE(s.strategic_interpretation, s.description) AS body, s.importance
       FROM signals s JOIN organization_technologies ot ON ot.organization_id = s.organization_id
       WHERE ot.technology_id = ? AND s.date >= ? ORDER BY s.date DESC LIMIT 20`
    ).bind(entityId, since).all<Record<string, unknown>>();
    candidates = rows.results.map((r) => ({ alert_type: r.signal_type as string, title: r.title as string, body: r.body as string | null, importance: r.importance as string }));
  } else if (entityType === 'person') {
    const rows = await db.prepare(
      `SELECT s.signal_type, s.title, COALESCE(s.strategic_interpretation, s.description) AS body, s.importance
       FROM signals s JOIN organization_people op ON op.organization_id = s.organization_id
       WHERE op.person_id = ? AND op.is_current = 1 AND s.date >= ? ORDER BY s.date DESC LIMIT 20`
    ).bind(entityId, since).all<Record<string, unknown>>();
    candidates = rows.results.map((r) => ({ alert_type: r.signal_type as string, title: r.title as string, body: r.body as string | null, importance: r.importance as string }));
  } else if (entityType === 'market') {
    const rows = await db.prepare(
      `SELECT signal_type, title, COALESCE(strategic_interpretation, description) AS body, importance
       FROM signals WHERE date >= ? ORDER BY date DESC LIMIT 30`
    ).bind(since).all<Record<string, unknown>>();
    candidates = rows.results.map((r) => ({ alert_type: r.signal_type as string, title: r.title as string, body: r.body as string | null, importance: r.importance as string }));
  }

  let count = 0;
  for (const c of candidates) {
    await insertAlertIfNew(db, userId, entityType, entityId, c.alert_type, c.title, c.body, c.importance);
    count++;
  }
  return count;
}

// ------------------------------------------------------------
// Feed
// ------------------------------------------------------------

export interface AlertRow {
  id: string;
  entity_type: WatchEntityType;
  entity_id: string;
  entity_name: string | null;
  alert_type: string;
  title: string;
  body: string | null;
  importance: string;
  is_read: number;
  created_at: string;
}

export async function unreadCount(db: D1Database, userId: string): Promise<number> {
  await ensureUser(db, userId);
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND is_read = 0`)
    .bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listAlerts(
  db: D1Database,
  userId: string,
  opts: { importance?: string; unread_only?: boolean; limit?: number; offset?: number }
): Promise<{ rows: AlertRow[]; total: number; unread: number }> {
  await ensureUser(db, userId);
  const clauses = [`user_id = ?`];
  const params: unknown[] = [userId];
  if (opts.importance) { clauses.push(`importance = ?`); params.push(opts.importance); }
  if (opts.unread_only) clauses.push(`is_read = 0`);
  const where = `WHERE ${clauses.join(' AND ')}`;
  const limit = Math.min(100, opts.limit ?? 25);
  const offset = Math.max(0, opts.offset ?? 0);

  const [totalRow, unreadRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM alerts ${where}`).bind(...params).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND is_read = 0`).bind(userId).first<{ n: number }>(),
    db.prepare(`SELECT id, entity_type, entity_id, alert_type, title, body, importance, is_read, created_at
                FROM alerts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<Record<string, unknown>>(),
  ]);

  const names = await entityNames(db, rows.results.map((r) => ({ entity_type: r.entity_type as string, entity_id: r.entity_id as string })));
  return {
    rows: rows.results.map((r) => ({
      id: r.id as string,
      entity_type: r.entity_type as WatchEntityType,
      entity_id: r.entity_id as string,
      entity_name: names.get(`${r.entity_type}:${r.entity_id}`) ?? null,
      alert_type: r.alert_type as string,
      title: r.title as string,
      body: r.body as string | null,
      importance: r.importance as string,
      is_read: r.is_read as number,
      created_at: r.created_at as string,
    })),
    total: totalRow?.n ?? 0,
    unread: unreadRow?.n ?? 0,
  };
}

export async function markRead(db: D1Database, userId: string, ids?: string[]): Promise<number> {
  await ensureUser(db, userId);
  if (ids && ids.length) {
    const inIds = ids.map(() => '?').join(',');
    const res = await db.prepare(`UPDATE alerts SET is_read = 1 WHERE user_id = ? AND id IN (${inIds})`).bind(userId, ...ids).run();
    return res.meta?.changes as number ?? 0;
  }
  const res = await db.prepare(`UPDATE alerts SET is_read = 1 WHERE user_id = ? AND is_read = 0`).bind(userId).run();
  return res.meta?.changes as number ?? 0;
}
