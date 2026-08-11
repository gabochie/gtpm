// ============================================================
// GTPM — Core domain types (mirror of D1 schema)
// ============================================================

export type OrgType =
  | 'startup' | 'scaleup' | 'corporation' | 'bank' | 'telecom'
  | 'university' | 'research' | 'government' | 'accelerator' | 'incubator'
  | 'venture_fund' | 'ngo' | 'community' | 'media' | 'regulator' | 'infrastructure';

export type VerificationStatus = 'verified' | 'reported' | 'inferred' | 'estimated' | 'ai_hypothesis';

export type MonitorFrequency = 'daily' | 'biweekly' | 'weekly' | 'monthly';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  org_type: OrgType;
  description: string | null;
  overview: string | null;
  founded_year: number | null;
  hq_location_id: string | null;
  website: string | null;
  socials: Record<string, string>;
  email: string | null;
  employee_count: number | null;
  funding_status: string | null;
  status: 'active' | 'acquired' | 'inactive' | 'unknown';
  verification_status: VerificationStatus;
  confidence: number;
  last_verified: string | null;
  last_checked: string | null;
  next_check: string | null;
  monitor_frequency: MonitorFrequency;
  is_private: number;
  is_seed: number;
  created_at: string;
  updated_at: string;
  // joined (not columns)
  sectors?: Sector[];
  technologies?: Technology[];
  hq_location?: Location | null;
}

export interface Sector {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  sort_order: number;
  org_count?: number;
  is_primary?: number;
}

export interface Technology {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycle: 'experimental' | 'emerging' | 'growing' | 'established' | 'declining';
  radar_ring: 'EXPERIMENTAL' | 'EMERGING' | 'ACCELERATING' | 'MAINSTREAM' | 'DECLINING';
  trend_score: number | null;
  org_count?: number;
}

export interface Location {
  id: string;
  slug: string;
  name: string;
  type: 'city' | 'region' | 'country' | 'cluster';
  parent_id: string | null;
  country_code: string;
  lat: number | null;
  lng: number | null;
  is_capital: number;
  org_count?: number;
}

export type PersonRole =
  | 'founder' | 'executive' | 'investor' | 'researcher'
  | 'policymaker' | 'academic' | 'community' | 'engineer';

export interface Person {
  id: string;
  slug: string;
  name: string;
  role: PersonRole;
  title: string | null;
  bio: string | null;
  location_id: string | null;
  linkedin: string | null;
  twitter: string | null;
  website: string | null;
  image_url: string | null;
  verification_status: VerificationStatus;
  confidence: number;
  organizations?: { org: { id: string; slug: string; name: string }; role: string; is_founder: number }[];
}

export interface Product {
  id: string;
  slug: string;
  organization_id: string;
  name: string;
  description: string | null;
  category: string | null;
  target_users: string | null;
  business_model: string | null;
  pricing: string | null;
  technology: string[];
  launch_date: string | null;
  status: 'active' | 'beta' | 'discontinued' | 'planned';
  url: string | null;
}

export type RoundType =
  | 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'series_c'
  | 'grant' | 'debt' | 'accelerator' | 'pe' | 'strategic' | 'ipo' | 'unknown';

export interface FundingRound {
  id: string;
  organization_id: string;
  round_type: RoundType;
  amount_usd: number | null;
  amount_original: number | null;
  currency: string | null;
  date: string | null;
  date_precision: 'day' | 'month' | 'year';
  investors: { name: string; type?: string }[];
  lead_investor: string | null;
  valuation: string | null;
  notes: string | null;
  source_id: string | null;
  confidence: number;
  organization?: { slug: string; name: string };
}

export interface Competitor {
  id: string;
  organization_id: string;
  competitor_org_id: string;
  competition_type: 'direct' | 'indirect' | 'emerging' | 'global' | 'substitute' | 'disruptor';
  strength: number;
  evidence: string | null;
  competitor?: { slug: string; name: string; org_type: OrgType; description: string | null };
}

export type CompetitionType = Competitor['competition_type'];

export interface Partnership {
  id: string;
  org_a_id: string;
  org_b_id: string;
  partnership_type: string;
  description: string | null;
  date: string | null;
  status: string;
  partner?: { slug: string; name: string; org_type: OrgType };
}

export type Importance = 'critical' | 'important' | 'signal';

export interface EventItem {
  id: string;
  organization_id: string | null;
  event_type: string;
  title: string;
  description: string | null;
  date: string | null;
  date_precision: 'day' | 'month' | 'year';
  importance: Importance;
  metadata: Record<string, unknown>;
  source_id: string | null;
  organization?: { slug: string; name: string };
}

export interface Signal {
  id: string;
  organization_id: string | null;
  signal_type: string;
  title: string;
  description: string | null;
  importance: Importance;
  date: string;
  strategic_interpretation: string | null;
  source_id: string | null;
  claim_id: string | null;
  metadata: Record<string, unknown>;
  organization?: { slug: string; name: string };
}

export interface Opportunity {
  id: string;
  slug: string;
  title: string;
  problem: string | null;
  market: string | null;
  sector_id: string | null;
  location_id: string | null;
  existing_alternatives: string[];
  current_competitors: string[];
  why_now: string | null;
  technology_required: string[];
  barriers: string[];
  potential_customers: string | null;
  business_model: string | null;
  attractiveness: number;
  market_size: number | null;
  urgency: number | null;
  classification: 'BUILD_NOW' | 'WATCH' | 'AVOID' | 'EARLY_BET' | 'INFRASTRUCTURE' | 'WHITE_SPACE';
  evidence: string[];
  confidence: number;
  status: string;
  sector?: Sector | null;
}

export interface Relationship {
  id: string;
  from_entity_type: string;
  from_entity_id: string;
  to_entity_type: string;
  to_entity_id: string;
  relationship_type: string;
  description: string | null;
  confidence: number;
  from_name?: string;
  to_name?: string;
}

export interface Report {
  id: string;
  slug: string;
  title: string;
  report_type: string;
  content: unknown;
  status: string;
  generated_at: string | null;
}

export interface Source {
  id: string;
  url: string | null;
  title: string;
  publisher: string | null;
  source_type: string;
  reliability: number;
  robots_allowed: number;
  fetch_frequency: string;
  last_fetched: string | null;
  next_fetch: string | null;
  fetch_status: string;
}

export interface Claim {
  id: string;
  entity_type: string;
  entity_id: string;
  claim_type: string;
  claim: string;
  claim_value: string | null;
  confidence: number;
  verification_status: VerificationStatus;
  source_id: string | null;
  source_url: string | null;
  published_date: string | null;
  discovered_date: string;
  extracted_date: string;
  is_reviewed: number;
}

export interface Score {
  id: string;
  organization_id: string;
  dimension: string;
  score: number;
  methodology: string | null;
  evidence: string[];
  confidence: number;
  created_at: string;
}

export interface CompanyTimelineItem {
  date: string | null;
  date_precision: 'day' | 'month' | 'year';
  type: 'founded' | 'funding' | 'launch' | 'partnership' | 'leadership' | 'acquisition' | 'regulatory' | 'expansion' | 'hiring' | 'product' | 'signal';
  title: string;
  description: string | null;
  importance: Importance;
}

export interface CompanyProfile extends Organization {
  sectors: Sector[];
  technologies: Technology[];
  hq_location: Location | null;
  products: Product[];
  people: Person[];
  funding: FundingRound[];
  competitors: Competitor[];
  partnerships: Partnership[];
  events: EventItem[];
  signals: Signal[];
  scores: Score[];
  timeline: CompanyTimelineItem[];
  total_funding_usd: number | null;
  latest_funding: FundingRound | null;
  sources: Source[];
}

// ------------------------------------------------------------
// API envelope
// ------------------------------------------------------------
export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    page?: number;
    page_size?: number;
    total?: number;
    generated_at?: string;
    [k: string]: unknown;
  };
}

export interface ListQuery {
  page: number;
  page_size: number;
  q?: string;
  sector?: string;
  type?: string;
  sort?: string;
  location?: string;
}
