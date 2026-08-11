// ============================================================
// GTPM — shared utilities
// ============================================================

import type { ListQuery } from '../types';

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseListQuery(query: Record<string, string | undefined>): ListQuery {
  const page = Math.max(1, parseInt(query['page'] ?? '1', 10) || 1);
  const page_size = Math.min(100, Math.max(1, parseInt(query['page_size'] ?? '20', 10) || 20));
  return {
    page,
    page_size,
    q: query['q']?.trim() || undefined,
    sector: query['sector']?.trim() || undefined,
    type: query['type']?.trim() || undefined,
    sort: query['sort']?.trim() || undefined,
    location: query['location']?.trim() || undefined,
  };
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  page_size: number;
}

export function buildWhere(
  clauses: string[],
  params: unknown[]
): { where: string; params: unknown[] } {
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Converts a DB row (kebab/snake JSON strings) into typed objects. */
export function mapRow<T>(row: Record<string, unknown>, jsonCols: string[] = []): T {
  const out: Record<string, unknown> = { ...row };
  for (const col of jsonCols) {
    out[col] = parseJson(row[col] as string | null | undefined, []);
  }
  return out as T;
}

export function fmtMoney(amountUsd: number | null): string | null {
  if (amountUsd == null) return null;
  if (amountUsd >= 1_000_000) {
    const m = amountUsd / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (amountUsd >= 1_000) {
    const k = amountUsd / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${amountUsd}`;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
