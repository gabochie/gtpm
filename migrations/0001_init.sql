-- ============================================================
-- GTPM — Ghana Technology & Power Map
-- Migration 0001: Initial schema
-- Design: unified entity model, event-sourced intelligence,
-- provenance-backed claims, geography-ready (Ghana → Africa).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- AUTH / USERS
-- ------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                -- UUID
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                   -- PBKDF2/argon2
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'subscriber' -- subscriber | analyst | admin
                CHECK (role IN ('subscriber','analyst','admin')),
  is_private    INTEGER NOT NULL DEFAULT 0,      -- Gabochie private-mode flag
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL,                   -- never store raw keys
  scopes        TEXT NOT NULL DEFAULT '[]',      -- JSON array
  rate_limit    INTEGER NOT NULL DEFAULT 1000,
  revoked       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT
);

-- ------------------------------------------------------------
-- TAXONOMY: SECTORS, TECHNOLOGIES, LOCATIONS
-- ------------------------------------------------------------
CREATE TABLE sectors (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES sectors(id),
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE technologies (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  lifecycle     TEXT NOT NULL DEFAULT 'emerging'
                CHECK (lifecycle IN ('experimental','emerging','growing','established','declining')),
  -- Technology Radar quadrant classifications
  radar_ring    TEXT NOT NULL DEFAULT 'EMERGING'
                CHECK (radar_ring IN ('EXPERIMENTAL','EMERGING','ACCELERATING','MAINSTREAM','DECLINING')),
  trend_score   REAL,                            -- -1..1 momentum
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'city'
                CHECK (type IN ('city','region','country','cluster')),
  parent_id     TEXT REFERENCES locations(id),
  country_code  TEXT NOT NULL DEFAULT 'GH',
  lat           REAL,
  lng           REAL,
  is_capital    INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- ORGANIZATIONS (unified entity)
-- ------------------------------------------------------------
CREATE TABLE organizations (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  org_type        TEXT NOT NULL DEFAULT 'startup'
                  CHECK (org_type IN ('startup','scaleup','corporation','bank','telecom',
                    'university','research','government','accelerator','incubator',
                    'venture_fund','ngo','community','media','regulator','infrastructure')),
  description     TEXT,
  overview        TEXT,                          -- longer editorial overview
  founded_year    INTEGER,
  hq_location_id  TEXT REFERENCES locations(id),
  website         TEXT,
  socials         TEXT NOT NULL DEFAULT '{}',    -- JSON {linkedin, twitter, facebook, ...}
  email           TEXT,
  employee_count  INTEGER,
  funding_status  TEXT,                          -- bootstrapped | seed | series_a | ...
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','acquired','inactive','unknown')),
  -- Provenance + freshness (spec §20, §21)
  verification_status TEXT NOT NULL DEFAULT 'reported'
                  CHECK (verification_status IN ('verified','reported','inferred','estimated','ai_hypothesis')),
  confidence      REAL NOT NULL DEFAULT 0.5,     -- 0..1
  last_verified   TEXT,
  last_checked    TEXT,
  next_check      TEXT,
  monitor_frequency TEXT NOT NULL DEFAULT 'weekly'
                  CHECK (monitor_frequency IN ('daily','biweekly','weekly','monthly')),
  is_private      INTEGER NOT NULL DEFAULT 0,    -- private intelligence (Gabochie mode)
  is_seed         INTEGER NOT NULL DEFAULT 0,    -- part of the initial 50
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orgs_type ON organizations(org_type);
CREATE INDEX idx_orgs_status ON organizations(status);
CREATE INDEX idx_orgs_freq ON organizations(monitor_frequency);
CREATE INDEX idx_orgs_next_check ON organizations(next_check);

CREATE TABLE organization_sectors (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sector_id       TEXT NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  is_primary      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, sector_id)
);
CREATE INDEX idx_org_sectors_sector ON organization_sectors(sector_id);

CREATE TABLE organization_technologies (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  technology_id   TEXT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  adoption_level  TEXT DEFAULT 'exploring'
                  CHECK (adoption_level IN ('exploring','piloting','adopted','advanced')),
  PRIMARY KEY (organization_id, technology_id)
);

-- ------------------------------------------------------------
-- PEOPLE
-- ------------------------------------------------------------
CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'executive'
                CHECK (role IN ('founder','executive','investor','researcher',
                  'policymaker','academic','community','engineer')),
  title         TEXT,
  bio           TEXT,
  location_id   TEXT REFERENCES locations(id),
  linkedin      TEXT,
  twitter       TEXT,
  website       TEXT,
  image_url     TEXT,
  verification_status TEXT NOT NULL DEFAULT 'reported',
  confidence    REAL NOT NULL DEFAULT 0.5,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE organization_people (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role            TEXT,                          -- e.g. 'Co-founder & CEO'
  title           TEXT,
  is_founder      INTEGER NOT NULL DEFAULT 0,
  start_date      TEXT,
  end_date        TEXT,
  is_current      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, person_id)
);
CREATE INDEX idx_org_people_person ON organization_people(person_id);

-- ------------------------------------------------------------
-- PRODUCTS
-- ------------------------------------------------------------
CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT,                            -- saas | api | mobile | ai | platform | hardware | infrastructure
  target_users  TEXT,
  business_model TEXT,                           -- subscription | transaction | freemium | ...
  pricing       TEXT,                            -- public info only
  technology    TEXT NOT NULL DEFAULT '[]',      -- JSON array of tech tags
  launch_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','beta','discontinued','planned')),
  url           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_org ON products(organization_id);

-- ------------------------------------------------------------
-- CAPITAL
-- ------------------------------------------------------------
CREATE TABLE investors (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  investor_type TEXT NOT NULL DEFAULT 'vc'
                CHECK (investor_type IN ('vc','angel','corporate','government',
                  'accelerator','family_office','pe','bank','foundation')),
  country_code  TEXT NOT NULL DEFAULT 'GH',
  website       TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE funding_rounds (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  round_type    TEXT NOT NULL DEFAULT 'seed'
                CHECK (round_type IN ('pre_seed','seed','series_a','series_b','series_c',
                  'grant','debt','accelerator','pe','strategic','ipo','unknown')),
  amount_usd    REAL,                            -- normalized for comparisons
  amount_original REAL,
  currency      TEXT DEFAULT 'USD',
  date          TEXT,                            -- announced/closed date (ISO)
  date_precision TEXT NOT NULL DEFAULT 'month'
                CHECK (date_precision IN ('day','month','year')),
  investors     TEXT NOT NULL DEFAULT '[]',      -- JSON [{name, type}]
  lead_investor TEXT,
  valuation     TEXT,                            -- reported valuation as text (avoid false precision)
  notes         TEXT,
  source_id     TEXT REFERENCES sources(id),
  confidence    REAL NOT NULL DEFAULT 0.7,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_funding_org ON funding_rounds(organization_id);
CREATE INDEX idx_funding_date ON funding_rounds(date);

-- ------------------------------------------------------------
-- SOURCES & PROVENANCE (spec §20)
-- ------------------------------------------------------------
CREATE TABLE sources (
  id              TEXT PRIMARY KEY,
  url             TEXT,
  title           TEXT NOT NULL,
  publisher       TEXT,
  source_type     TEXT NOT NULL DEFAULT 'news'
                  CHECK (source_type IN ('official','government','ecosystem','news',
                    'social','research','database','regulator')),
  reliability     REAL NOT NULL DEFAULT 0.5,     -- self-improving reliability score (spec §36)
  robots_allowed  INTEGER NOT NULL DEFAULT 1,
  fetch_frequency TEXT NOT NULL DEFAULT 'weekly',
  last_fetched    TEXT,
  next_fetch      TEXT,
  fetch_status    TEXT DEFAULT 'idle'
                  CHECK (fetch_status IN ('idle','fetching','ok','failed','blocked')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sources_url ON sources(url);

-- Claims: every important data point carries provenance (spec §20)
CREATE TABLE claims (
  id                TEXT PRIMARY KEY,
  entity_type       TEXT NOT NULL,               -- organization | person | product | sector | technology
  entity_id         TEXT NOT NULL,
  claim_type        TEXT NOT NULL,               -- funding | partnership | launch | leadership | ...
  claim             TEXT NOT NULL,               -- human-readable statement
  claim_value       TEXT,                        -- JSON structured value
  confidence        REAL NOT NULL DEFAULT 0.5,
  verification_status TEXT NOT NULL DEFAULT 'reported'
                    CHECK (verification_status IN ('verified','reported','inferred','estimated','ai_hypothesis')),
  source_id         TEXT REFERENCES sources(id),
  source_url        TEXT,
  published_date    TEXT,
  discovered_date   TEXT NOT NULL DEFAULT (datetime('now')),
  extracted_date    TEXT NOT NULL DEFAULT (datetime('now')),
  is_reviewed       INTEGER NOT NULL DEFAULT 0,  -- human-in-the-loop (spec §27)
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claims_entity ON claims(entity_type, entity_id);
CREATE INDEX idx_claims_status ON claims(verification_status);

-- ------------------------------------------------------------
-- INTELLIGENCE MEMORY (spec §22): event sourcing via snapshots
-- ------------------------------------------------------------
CREATE TABLE company_snapshots (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL DEFAULT (datetime('now')),
  data          TEXT NOT NULL DEFAULT '{}',      -- full JSON state at time of snapshot
  diff_summary  TEXT DEFAULT '[]',               -- JSON array of changes vs previous
  created_by    TEXT NOT NULL DEFAULT 'manual'
                CHECK (created_by IN ('manual','scout','company_monitor','analyst','system')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_org ON company_snapshots(organization_id, snapshot_date);

CREATE TABLE company_metrics (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_type   TEXT NOT NULL,                   -- employees | users | revenue | valuation | downloads | ...
  value         REAL,
  unit          TEXT,
  date          TEXT,
  source_id     TEXT REFERENCES sources(id),
  confidence    REAL NOT NULL DEFAULT 0.5,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_metrics_org ON company_metrics(organization_id, metric_type);

-- ------------------------------------------------------------
-- COMPETITIVE INTELLIGENCE (spec §9, §11)
-- ------------------------------------------------------------
CREATE TABLE competitors (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competition_type TEXT NOT NULL DEFAULT 'direct'
                  CHECK (competition_type IN ('direct','indirect','emerging','global','substitute','disruptor')),
  strength        REAL NOT NULL DEFAULT 0.5,     -- 0..1 competitive pressure
  evidence        TEXT,
  source_id       TEXT REFERENCES sources(id),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, competitor_org_id, competition_type)
);
CREATE INDEX idx_competitors_org ON competitors(organization_id);

-- Scored dimensions (spec §9) — transparent scoring with methodology + evidence
CREATE TABLE scores (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dimension       TEXT NOT NULL,                 -- technology_strength | market_position | growth_momentum |
                                                -- funding_strength | talent_strength | product_strength |
                                                -- ecosystem_influence | innovation_velocity | strategic_threat | opportunity_attractiveness
  score           REAL NOT NULL,                 -- 0..100
  methodology     TEXT,
  evidence        TEXT DEFAULT '[]',             -- JSON array of supporting evidence refs
  confidence      REAL NOT NULL DEFAULT 0.5,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, dimension, created_at)
);
CREATE INDEX idx_scores_org ON scores(organization_id);

-- ------------------------------------------------------------
-- RELATIONSHIP GRAPH (spec §15)
-- ------------------------------------------------------------
CREATE TABLE relationships (
  id              TEXT PRIMARY KEY,
  from_entity_type TEXT NOT NULL,                -- organization | person | product | technology | sector | location
  from_entity_id   TEXT NOT NULL,
  to_entity_type   TEXT NOT NULL,
  to_entity_id     TEXT NOT NULL,
  relationship_type TEXT NOT NULL,               -- invests_in | partners_with | founded_by | employs |
                                                -- competes_with | acquired | regulates | tracks | supplies | ...
  description     TEXT,
  source_id       TEXT REFERENCES sources(id),
  confidence      REAL NOT NULL DEFAULT 0.6,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rels_from ON relationships(from_entity_type, from_entity_id);
CREATE INDEX idx_rels_to ON relationships(to_entity_type, to_entity_id);

CREATE TABLE partnerships (
  id            TEXT PRIMARY KEY,
  org_a_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  org_b_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partnership_type TEXT NOT NULL,                -- strategic | bank_integration | telecom | government_contract |
                                                -- university | international | api_integration | distribution
  description   TEXT,
  date          TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','ended','announced','rumored')),
  source_id     TEXT REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_partnerships_a ON partnerships(org_a_id);
CREATE INDEX idx_partnerships_b ON partnerships(org_b_id);

-- ------------------------------------------------------------
-- EVENTS / SIGNALS (spec §10, §11)
-- ------------------------------------------------------------
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,                   -- launch | funding | partnership | acquisition |
                                                -- regulatory | leadership | product | expansion | hiring
  title         TEXT NOT NULL,
  description   TEXT,
  date          TEXT,
  date_precision TEXT NOT NULL DEFAULT 'month',
  importance    TEXT NOT NULL DEFAULT 'signal'
                CHECK (importance IN ('critical','important','signal')),
  metadata      TEXT NOT NULL DEFAULT '{}',      -- JSON extra structured data
  source_id     TEXT REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_org ON events(organization_id, date);

CREATE TABLE signals (
  id            TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL,                   -- ai_investment | hiring_surge | product_launch |
                                                -- partnership | expansion | funding | tech_adoption | ...
  title         TEXT NOT NULL,
  description   TEXT,
  importance    TEXT NOT NULL DEFAULT 'signal'
                CHECK (importance IN ('critical','important','signal')),
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  strategic_interpretation TEXT,                 -- "why this matters" (spec §10)
  source_id     TEXT REFERENCES sources(id),
  claim_id      TEXT REFERENCES claims(id),
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_signals_org ON signals(organization_id, date);

-- Job postings as strategic-direction signals (spec §8 Agent 6)
CREATE TABLE jobs_signals (
  id            TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_title     TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'engineering',
  posted_date   TEXT,
  url           TEXT,
  source_id     TEXT REFERENCES sources(id),
  detected_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_org ON jobs_signals(organization_id);

-- Technology adoption signals (spec §8 Agent 5)
CREATE TABLE technology_signals (
  id            TEXT PRIMARY KEY,
  technology_id TEXT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL,                   -- adoption | investment | hiring | launch | mention
  description   TEXT,
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  source_id     TEXT REFERENCES sources(id),
  confidence    REAL NOT NULL DEFAULT 0.5,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tech_signals ON technology_signals(technology_id, date);

-- ------------------------------------------------------------
-- NEWS / MEDIA
-- ------------------------------------------------------------
CREATE TABLE news_items (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  url             TEXT,
  publisher       TEXT,
  published_date  TEXT,
  discovered_date TEXT NOT NULL DEFAULT (datetime('now')),
  summary         TEXT,
  org_ids         TEXT NOT NULL DEFAULT '[]',    -- JSON array
  sector_ids      TEXT NOT NULL DEFAULT '[]',
  source_id       TEXT REFERENCES sources(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_news_date ON news_items(published_date);

-- ------------------------------------------------------------
-- REGULATORY INTELLIGENCE (spec §8 Agent 8)
-- ------------------------------------------------------------
CREATE TABLE regulations (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body            TEXT,
  agency          TEXT,
  jurisdiction    TEXT NOT NULL DEFAULT 'GH',
  sector_ids      TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','in_force','repealed','draft','consultation')),
  published_date  TEXT,
  effective_date  TEXT,
  impact_analysis TEXT DEFAULT '{}',             -- JSON {affected_companies, compliance, opportunities, threats}
  source_id       TEXT REFERENCES sources(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- OPPORTUNITY DETECTION (spec §8 Agent 9, §31)
-- ------------------------------------------------------------
CREATE TABLE opportunities (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  problem             TEXT,
  market              TEXT,
  sector_id           TEXT REFERENCES sectors(id),
  location_id         TEXT REFERENCES locations(id),
  existing_alternatives TEXT DEFAULT '[]',
  current_competitors TEXT DEFAULT '[]',
  why_now             TEXT,
  technology_required TEXT DEFAULT '[]',
  barriers            TEXT DEFAULT '[]',
  potential_customers TEXT,
  business_model      TEXT,
  attractiveness      REAL NOT NULL DEFAULT 0.5, -- 0..1 composite
  market_size         REAL,
  urgency             REAL,
  classification      TEXT NOT NULL DEFAULT 'WATCH'
                      CHECK (classification IN ('BUILD_NOW','WATCH','AVOID','EARLY_BET','INFRASTRUCTURE','WHITE_SPACE')),
  evidence            TEXT DEFAULT '[]',
  confidence          REAL NOT NULL DEFAULT 0.5,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','closed','validated')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_opps_class ON opportunities(classification);

-- ------------------------------------------------------------
-- ALERTS / WATCHLISTS (spec §11)
-- ------------------------------------------------------------
CREATE TABLE watchlists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,                   -- organization | sector | technology | person | market
  entity_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, entity_type, entity_id)
);

CREATE TABLE alerts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  alert_type    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  importance    TEXT NOT NULL DEFAULT 'signal'
                CHECK (importance IN ('critical','important','signal')),
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alerts_user ON alerts(user_id, is_read);

-- ------------------------------------------------------------
-- REPORTS (spec §13, §14, §43)
-- ------------------------------------------------------------
CREATE TABLE reports (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  report_type   TEXT NOT NULL DEFAULT 'custom'
                CHECK (report_type IN ('daily_brief','weekly_review','monthly_radar','sector','custom','infrastructure_gaps')),
  content       TEXT NOT NULL DEFAULT '{}',      -- JSON structured content
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
  generated_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- AGENT ORCHESTRATION (spec §25) & AUDIT
-- ------------------------------------------------------------
CREATE TABLE agent_runs (
  id              TEXT PRIMARY KEY,
  agent_name      TEXT NOT NULL,                 -- scout | company_monitor | competitive | funding | radar | talent | partnership | regulatory | opportunity | advisor
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','success','failed','partial')),
  input           TEXT DEFAULT '{}',
  output          TEXT DEFAULT '{}',
  error           TEXT,
  items_processed INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);
CREATE INDEX idx_agent_runs ON agent_runs(agent_name, started_at);

CREATE TABLE review_queue (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,                   -- claim | organization | relationship | opportunity
  entity_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,                   -- uncertain_match | funding_estimate | controversial | low_confidence | conflicting_sources | duplicate
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','corrected','merged','flagged')),
  reviewer_id   TEXT REFERENCES users(id),
  reviewed_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_review_pending ON review_queue(status);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  details       TEXT DEFAULT '{}',
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ------------------------------------------------------------
-- FULL-TEXT SEARCH (spec §29)
-- ------------------------------------------------------------
CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_type, entity_id, name, body, content
);

CREATE TRIGGER organizations_ai AFTER INSERT ON organizations BEGIN
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('organization', NEW.id, NEW.name, COALESCE(NEW.description,'') || ' ' || COALESCE(NEW.overview,''));
END;
CREATE TRIGGER organizations_ad AFTER DELETE ON organizations BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'organization', OLD.id);
END;
CREATE TRIGGER organizations_au AFTER UPDATE ON organizations BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'organization', OLD.id);
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('organization', NEW.id, NEW.name, COALESCE(NEW.description,'') || ' ' || COALESCE(NEW.overview,''));
END;

CREATE TRIGGER people_ai AFTER INSERT ON people BEGIN
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('person', NEW.id, NEW.name, COALESCE(NEW.bio,'') || ' ' || COALESCE(NEW.title,''));
END;
CREATE TRIGGER people_ad AFTER DELETE ON people BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'person', OLD.id);
END;
CREATE TRIGGER people_au AFTER UPDATE ON people BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'person', OLD.id);
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('person', NEW.id, NEW.name, COALESCE(NEW.bio,'') || ' ' || COALESCE(NEW.title,''));
END;

CREATE TRIGGER products_ai AFTER INSERT ON products BEGIN
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('product', NEW.id, NEW.name, COALESCE(NEW.description,''));
END;
CREATE TRIGGER products_ad AFTER DELETE ON products BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'product', OLD.id);
END;
CREATE TRIGGER products_au AFTER UPDATE ON products BEGIN
  INSERT INTO search_fts (search_fts, entity_type, entity_id) VALUES ('delete', 'product', OLD.id);
  INSERT INTO search_fts (entity_type, entity_id, name, body)
  VALUES ('product', NEW.id, NEW.name, COALESCE(NEW.description,''));
END;

-- ------------------------------------------------------------
-- DISCOVERY QUEUE (spec §35)
-- ------------------------------------------------------------
CREATE TABLE discovery_queue (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT,
  discovered_from TEXT,                          -- source URL that surfaced the entity
  proposed_sector TEXT,
  proposed_type   TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','verifying','classified','resolved','rejected','duplicate')),
  confidence      REAL NOT NULL DEFAULT 0.3,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
