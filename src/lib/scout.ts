// ============================================================
// GTPM — Scout engine (spec §8 Agent 1 + §7 Source pipeline)
//
// SOURCE DISCOVERY → FETCH → PARSE → EXTRACT → CLASSIFY
//
// A scout pass walks sources due for fetching, pulls their
// feeds (RSS/Atom preferred), extracts items, matches them to
// tracked organisations, promotes high-signal items into
// signals, and queues unrecognised entities in discovery_queue.
// Every step is deterministic and provenance-preserving: each
// produced item carries its source_id.
// ============================================================
import type { D1Database } from '../types-d1';
import { uuid, nowIso, slugify } from './utils';
import { fanoutSignal } from './alerts';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_SOURCES_PER_PASS = 8;

export interface ScoutRunSummary {
  sources_checked: number;
  sources_fetched: number;
  items_parsed: number;
  news_added: number;
  signals_created: number;
  discoveries_queued: number;
  run_at: string;
}

// ------------------------------------------------------------
// Feed parsing (RSS 2.0 / Atom subset — no external deps)
// ------------------------------------------------------------

interface ParsedItem {
  title: string;
  url: string;
  published_date: string | null;
  summary: string | null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractItems(xml: string, contentType: string): ParsedItem[] {
  const text = typeof xml === 'string' ? xml : '';
  const isXml = contentType.includes('xml') || contentType.includes('rss') || /^\s*<\?xml|<rss|<feed/i.test(text);
  if (!isXml) return [];

  const blocks: ParsedItem[] = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text)) && blocks.length < MAX_ITEMS_PER_SOURCE) {
    const inner = m[2];
    const pick = (tag: string) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const mm = r.exec(inner ?? '');
      return mm ? decodeXmlEntities(stripTags(mm[1] ?? '')).trim() : '';
    };
    const linkRe = /<(?:link|guid)\b[^>]*>([^<]+)<\/(?:link|guid)>/i;
    const linkAttr = /<link\b[^>]*href=["']([^"']+)["']/i;
    const lm = linkRe.exec(inner ?? '') ?? linkAttr.exec(inner ?? '');
    const title = pick('title');
    const url = lm ? decodeXmlEntities(lm[1] ?? '').trim() : '';
    const dateRaw = pick('pubDate') || pick('published') || pick('updated') || pick('date');
    const summary = pick('description') || pick('summary') || pick('content');
    if (!title) continue;
    let published: string | null = null;
    if (dateRaw) {
      const parsed = new Date(dateRaw);
      if (!Number.isNaN(parsed.getTime())) published = parsed.toISOString().slice(0, 10);
    }
    blocks.push({ title, url, published_date: published, summary: summary || null });
  }
  return blocks;
}

// ------------------------------------------------------------
// HTML handling — feed discovery + anchor fallback
// ------------------------------------------------------------

const FEED_LINK_RE = /<link\b[^>]*rel=["']alternate["'][^>]*>/gi;
const HREF_RE = /href=["']([^"']+)["']/i;
const TYPE_RE = /type=["']application\/(rss|atom)\+xml["']/i;

/** Finds an RSS/Atom feed URL referenced from an HTML page. */
function findFeedHref(html: string): string | null {
  let m: RegExpExecArray | null;
  while ((m = FEED_LINK_RE.exec(html))) {
    const tag = m[0];
    if (TYPE_RE.test(tag)) {
      const href = HREF_RE.exec(tag);
      if (href) return href[1] ?? null;
    }
  }
  return null;
}

const COMMON_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml'];

/** Resolves a possibly-relative URL against a base URL. */
function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

const NAV_ANCHOR_RE = /\b(home|about|contact|privacy|terms|login|sign ?in|sign ?up|careers|faq|help|search|menu|skip to content|cookie|cookies|facebook|twitter|linkedin|instagram|youtube|download|subscribe|newsletter)\b/i;
const MIN_ANCHOR_LEN = 24;

/**
 * Fallback item extraction from a plain HTML page: picks meaningful
 * anchors (text >= 24 chars, not nav boilerplate), dedupes by URL.
 */
function extractHtmlItems(html: string, baseUrl: string): ParsedItem[] {
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const items: ParsedItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) && items.length < MAX_ITEMS_PER_SOURCE) {
    const href = m[1];
    const text = decodeXmlEntities(stripTags(m[2] ?? '').replace(/\s+/g, ' ').trim());
    if (!href || text.length < MIN_ANCHOR_LEN) continue;
    if (NAV_ANCHOR_RE.test(text)) continue;
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    const url = resolveUrl(decodeXmlEntities(href), baseUrl);
    if (seen.has(url) || url === baseUrl) continue;
    seen.add(url);
    items.push({ title: text, url, published_date: null, summary: null });
  }
  return items;
}

// ------------------------------------------------------------
// Entity matching — deterministic, token-based
// ------------------------------------------------------------

interface OrgMatch {
  id: string;
  name: string;
}

const NORMALIZE_RE = /[^a-z0-9\s]/g;

// Generic tokens that carry no entity-identity (Ghana market domain).
const GENERIC_TOKENS = new Set([
  'ghana', 'africa', 'african', 'limited', 'ltd', 'company', 'group', 'holding', 'holdings',
  'bank', 'banking', 'tech', 'technology', 'digital', 'mobile', 'money', 'payment', 'payments',
  'financial', 'finance', 'solutions', 'solution', 'services', 'service', 'the', 'and', 'for',
]);

function tokenize(s: string): Set<string> {
  const t = s.toLowerCase().replace(NORMALIZE_RE, ' ').split(/\s+/).filter((w) => w.length >= 3);
  return new Set(t);
}

/**
 * Matches a news title against the org directory.
 * Rule: the full org name is a substring of the title, or a
 * non-generic token (len>=4) of the org name appears in the title.
 */
export function matchOrgs(title: string, orgs: OrgMatch[]): OrgMatch[] {
  const titleLower = title.toLowerCase();
  const titleTokens = tokenize(title);
  const hits = new Map<string, OrgMatch>();
  for (const org of orgs) {
    const nameLower = org.name.toLowerCase();
    if (titleLower.includes(nameLower)) { hits.set(org.id, org); continue; }
    const tokens = tokenize(org.name);
    for (const tok of tokens) {
      if (tok.length >= 4 && !GENERIC_TOKENS.has(tok) && titleTokens.has(tok)) {
        hits.set(org.id, org);
        break;
      }
    }
  }
  return [...hits.values()];
}

// ------------------------------------------------------------
// Signal classification
// ------------------------------------------------------------

const KEYWORD_RULES: { re: RegExp; signal_type: string; importance: string }[] = [
  { re: /\b(acqui[rs]|acquires|acquisition|merger|merges)\b/i, signal_type: 'acquisition', importance: 'critical' },
  { re: /\b(raise|raises|raised|funding|investment|invests|seed round|series [abc]|pre-seed|grant)\b/i, signal_type: 'funding', importance: 'important' },
  { re: /\b(partner|partnership|collaborat|integration with|teams up|joins forces)\b/i, signal_type: 'partnership', importance: 'important' },
  { re: /\b(launch|launches|launched|introduces|unveils|rolls out)\b/i, signal_type: 'product_launch', importance: 'important' },
  { re: /\b(regulat|licen[cs]e|compliance|central bank|authority|policy)\b/i, signal_type: 'regulatory', importance: 'important' },
  { re: /\b(hires|hiring|appoints|appointment|new ceo|new cto|leadership)\b/i, signal_type: 'leadership', importance: 'important' },
  { re: /\b(expands|expansion|enters|new office|opening)\b/i, signal_type: 'expansion', importance: 'signal' },
  { re: /\b(5g|ai|artificial intelligence|machine learning|fintech|mobile money|blockchain)\b/i, signal_type: 'tech_adoption', importance: 'signal' },
];

function classify(title: string, description: string | null): { signal_type: string; importance: string } {
  const haystack = `${title} ${description ?? ''}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(haystack)) return { signal_type: rule.signal_type, importance: rule.importance };
  }
  return { signal_type: 'news', importance: 'signal' };
}

// ------------------------------------------------------------
// Persistence
// ------------------------------------------------------------

async function newsExists(db: D1Database, url: string): Promise<boolean> {
  if (!url) return false;
  const row = await db.prepare(`SELECT 1 AS n FROM news_items WHERE url = ?`).bind(url).first<{ n: number }>();
  return !!row;
}

async function insertNewsItem(db: D1Database, item: ParsedItem, sourceId: string, orgIds: string[], sectorIds: string[]): Promise<void> {
  await db.prepare(
    `INSERT INTO news_items (id, title, url, publisher, published_date, discovered_date, summary, org_ids, sector_ids, source_id, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uuid(), item.title, item.url, item.published_date, nowIso(), item.summary,
    JSON.stringify(orgIds), JSON.stringify(sectorIds), sourceId, nowIso()
  ).run();
}

async function signalExists(db: D1Database, orgId: string, title: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS n FROM signals WHERE organization_id = ? AND title = ?`)
    .bind(orgId, title).first<{ n: number }>();
  return !!row;
}

/** Promotes a matched news item into a signal (with provenance + strategic note). */
async function createSignalFromNews(
  db: D1Database,
  item: ParsedItem,
  org: OrgMatch,
  sourceId: string,
  classification: { signal_type: string; importance: string }
): Promise<boolean> {
  if (await signalExists(db, org.id, item.title)) return false;
  const interpretation = `Auto-discovered via ${sourceId.slice(0, 8)}: "${item.summary ?? item.title}".`;
  await db.prepare(
    `INSERT INTO signals (id, organization_id, signal_type, title, description, importance, date, strategic_interpretation, source_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uuid(), org.id, classification.signal_type, item.title, item.summary, classification.importance,
    item.published_date ?? nowIso().slice(0, 10), interpretation, sourceId,
    JSON.stringify({ scout: true }), nowIso()
  ).run();
  return true;
}

async function queueDiscovery(db: D1Database, item: ParsedItem, sourceId: string): Promise<boolean> {
  const dup = await db.prepare(`SELECT 1 AS n FROM discovery_queue WHERE name = ?`)
    .bind(item.title).first<{ n: number }>();
  if (dup) return false;
  await db.prepare(
    `INSERT INTO discovery_queue (id, name, url, discovered_from, notes, status, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0.3, ?)`
  ).bind(uuid(), item.title, item.url, sourceId, item.summary, nowIso()).run();
  return true;
}

// ------------------------------------------------------------
// Source lifecycle
// ------------------------------------------------------------

async function fetchUrl(url: string): Promise<{ ok: boolean; contentType: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'GTPM-Scout/0.1 (intelligence crawler; research@gabochie.com)' } });
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    return { ok: res.ok, contentType, body: body.slice(0, 500_000) };
  } catch {
    return { ok: false, contentType: '', body: '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collects items from a source URL: XML feeds parse directly; HTML
 * pages are probed for a linked feed, then common feed paths, then
 * fall back to meaningful-anchor extraction.
 */
async function collectItems(url: string): Promise<{ ok: boolean; items: ParsedItem[] }> {
  const first = await fetchUrl(url);
  if (!first.ok) return { ok: false, items: [] };
  const xmlItems = extractItems(first.body, first.contentType);
  if (xmlItems.length) return { ok: true, items: xmlItems };

  const feedHref = findFeedHref(first.body);
  const candidates = feedHref
    ? [feedHref]
    : COMMON_FEED_PATHS.map((p) => resolveUrl(p, url));
  for (const feedUrl of candidates) {
    const feed = await fetchUrl(feedUrl);
    if (!feed.ok) continue;
    const feedItems = extractItems(feed.body, feed.contentType);
    if (feedItems.length) return { ok: true, items: feedItems };
  }
  return { ok: true, items: extractHtmlItems(first.body, url) };
}

function nextFetchDate(frequency: string, fromIso: string): string {
  const from = new Date(fromIso);
  const days = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : frequency === 'monthly' ? 30 : 7;
  from.setUTCDate(from.getUTCDate() + days);
  return from.toISOString();
}

/**
 * Runs one scout pass: fetches due sources, parses items, matches
 * orgs, writes news_items + signals, queues discoveries.
 */
export async function runScoutPass(db: D1Database): Promise<ScoutRunSummary> {
  const runAt = nowIso();
  const due = await db.prepare(
    `SELECT id, url, title, fetch_frequency, next_fetch FROM sources
     WHERE fetch_status != 'blocked' AND fetch_frequency != 'manual'
       AND (next_fetch IS NULL OR next_fetch <= ?)
     ORDER BY next_fetch IS NULL DESC, reliability DESC
     LIMIT ?`
  ).bind(runAt, MAX_SOURCES_PER_PASS).all<Record<string, unknown>>();

  const orgs = await db.prepare(`SELECT id, name FROM organizations WHERE is_private = 0`).all<OrgMatch>();
  const sectors = await db.prepare(`SELECT id, name FROM sectors`).all<{ id: string; name: string }>();

  const summary: ScoutRunSummary = { sources_checked: 0, sources_fetched: 0, items_parsed: 0, news_added: 0, signals_created: 0, discoveries_queued: 0, run_at: runAt };

  for (const src of due.results) {
    summary.sources_checked++;
    const sourceId = src.id as string;
    const url = src.url as string;
    const frequency = (src.fetch_frequency as string) || 'weekly';

    const { ok, items } = await collectItems(url);
    if (!ok) {
      await db.prepare(`UPDATE sources SET fetch_status = 'failed', last_fetched = ?, next_fetch = ? WHERE id = ?`)
        .bind(runAt, nextFetchDate(frequency, runAt), sourceId).run();
      continue;
    }

    summary.sources_fetched++;
    summary.items_parsed += items.length;
    await db.prepare(`UPDATE sources SET fetch_status = 'ok', last_fetched = ?, next_fetch = ? WHERE id = ?`)
      .bind(runAt, nextFetchDate(frequency, runAt), sourceId).run();

    for (const item of items) {
      if (await newsExists(db, item.url)) continue;
      const matches = matchOrgs(item.title, orgs.results);
      if (matches.length) {
        const sectorIds = sectors.results
          .filter((s) => item.title.toLowerCase().includes(s.name.toLowerCase()))
          .map((s) => s.id);
        await insertNewsItem(db, item, sourceId, matches.map((m) => m.id), sectorIds);
        summary.news_added++;
        const classification = classify(item.title, item.summary);
        for (const org of matches) {
          if (await createSignalFromNews(db, item, org, sourceId, classification)) {
            summary.signals_created++;
            await fanoutSignal(db, {
              id: uuid(), organization_id: org.id, title: item.title,
              signal_type: classification.signal_type, importance: classification.importance,
              date: item.published_date ?? nowIso().slice(0, 10),
              description: item.summary, strategic_interpretation: null,
            });
          }
        }
      } else {
        if (await queueDiscovery(db, item, sourceId)) summary.discoveries_queued++;
      }
    }
  }

  return summary;
}

// ------------------------------------------------------------
// Manual ingestion — analyst-submitted news item
// ------------------------------------------------------------

export interface IngestInput {
  title: string;
  url?: string;
  publisher?: string;
  summary?: string;
  published_date?: string;
}

export async function ingestNewsItem(db: D1Database, input: IngestInput): Promise<{ status: string; org_matches: string[]; signal_created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new Error('title_required');
  const sourceId = input.publisher ? await ensurePublisherSource(db, input.publisher, input.url) : null;
  const orgs = await db.prepare(`SELECT id, name FROM organizations WHERE is_private = 0`).all<OrgMatch>();
  const matches = matchOrgs(title, orgs.results);
  const item: ParsedItem = {
    title,
    url: input.url ?? '',
    published_date: input.published_date ?? nowIso().slice(0, 10),
    summary: input.summary ?? null,
  };

  if (await newsExists(db, item.url)) return { status: 'duplicate', org_matches: matches.map((m) => m.name), signal_created: false };
  await insertNewsItem(db, item, sourceId ?? '', matches.map((m) => m.id), []);

  let signalCreated = false;
  if (matches.length) {
    const classification = classify(title, item.summary);
    for (const org of matches) {
      if (await createSignalFromNews(db, item, org, sourceId ?? '', classification)) {
        signalCreated = true;
        await fanoutSignal(db, {
          id: uuid(), organization_id: org.id, title,
          signal_type: classification.signal_type, importance: classification.importance,
          date: item.published_date ?? nowIso().slice(0, 10),
          description: item.summary, strategic_interpretation: null,
        });
      }
    }
  } else {
    await queueDiscovery(db, item, sourceId ?? '');
  }

  return { status: matches.length ? 'matched' : 'queued_for_discovery', org_matches: matches.map((m) => m.name), signal_created: signalCreated };
}

async function ensurePublisherSource(db: D1Database, publisher: string, url: string | undefined): Promise<string> {
  const existing = await db.prepare(`SELECT id FROM sources WHERE title = ? AND source_type = 'news'`).bind(publisher).first<{ id: string }>();
  if (existing) return existing.id;
  const id = uuid();
  await db.prepare(
    `INSERT INTO sources (id, url, title, publisher, source_type, reliability, robots_allowed, fetch_frequency, fetch_status, created_at)
     VALUES (?, ?, ?, ?, 'news', 0.6, 1, 'manual', 'idle', ?)`
  ).bind(id, url ?? `https://${slugify(publisher)}`, publisher, publisher, nowIso()).run();
  return id;
}
