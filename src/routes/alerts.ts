// ============================================================
// GTPM — /api/alerts + /api/watchlists (spec §11 Competitive Alerts)
//
// User identity: x-user-id header (device id, Phase 4 auth replaces).
// Follow entities, list alert feeds, mark read.
// ============================================================
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { D1Database } from '../types-d1';
import { WATCH_TYPES, follow, unfollow, listFollows, listAlerts, markRead, unreadCount, ensureUser, type WatchEntityType } from '../lib/alerts';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

type AlertsEnv = { Bindings: { DB: D1Database } };

function userId(c: Context<AlertsEnv>): string | null {
  const id = c.req.header('x-user-id');
  return id && /^[0-9a-f-]{8,64}$/i.test(id) ? id : null;
}

// ------------------------------------------------------------
// /api/watchlists
// ------------------------------------------------------------

app.get('/watchlists', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  const rows = await listFollows(c.env.DB, uid);
  return c.json({ data: rows });
});

app.post('/watchlists', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  const body = await c.req.json<{ entity_type?: string; entity_id?: string }>().catch(() => ({}) as { entity_type?: string; entity_id?: string });
  const entityType = body.entity_type as WatchEntityType | undefined;
  const entityId = body.entity_id?.trim();
  if (!entityType || !WATCH_TYPES.includes(entityType)) return c.json({ error: 'invalid_entity_type' }, 400);
  if (!entityId) return c.json({ error: 'entity_id_required' }, 400);
  const result = await follow(c.env.DB, uid, entityType, entityId);
  return c.json({ data: result });
});

app.delete('/watchlists/:entityType/:entityId', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  const { entityType, entityId } = c.req.param();
  const ok = await unfollow(c.env.DB, uid, entityType, entityId);
  if (!ok) return c.json({ error: 'unfollow_failed' }, 400);
  return c.json({ data: { unfollowed: true } });
});

// ------------------------------------------------------------
// /api/alerts
// ------------------------------------------------------------

app.get('/alerts', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  const q = c.req.query();
  const importance = q['importance'] || undefined;
  const unread_only = q['unread'] === '1' || q['unread'] === 'true';
  const limit = Math.min(100, parseInt(q['limit'] ?? '25', 10) || 25);
  const offset = Math.max(0, parseInt(q['offset'] ?? '0', 10) || 0);
  const data = await listAlerts(c.env.DB, uid, { importance, unread_only, limit, offset });
  return c.json({ data: { ...data, rows: data.rows } });
});

app.post('/alerts/read', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
  const changed = await markRead(c.env.DB, uid, body.ids);
  return c.json({ data: { marked_read: changed } });
});

app.get('/alerts/unread-count', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'user_id_required' }, 400);
  await ensureUser(c.env.DB, uid);
  const n = await unreadCount(c.env.DB, uid);
  return c.json({ data: { unread: n } });
});

export default app;
