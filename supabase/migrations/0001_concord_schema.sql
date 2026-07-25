-- Concord schema (spec §6). Requires the pgvector extension.
create extension if not exists vector;

-- ============ WORKS ============
create table concord_works (
  id                text primary key,          -- e.g. 'father:athanasius:de-incarnatione'
  title             text not null,
  author            text,
  author_died_year  int,
  composed_year     int,
  composed_era      text not null check (composed_era in (
    'second-temple','apostolic','ante-nicene','nicene','post-nicene',
    'medieval','reformation','post-reformation','modern','contemporary')),
  tradition         text not null check (tradition in (
    'catholic-roman','catholic-eastern','orthodox-eastern','orthodox-oriental',
    'lutheran','reformed','anglican','anabaptist','baptist','methodist-wesleyan',
    'pentecostal','holiness','restoration-movement','dispensational',
    'patristic-undivided','judaism-second-temple','judaism-rabbinic',
    'judaism-orthodox','judaism-conservative','judaism-reform',
    'islam-sunni','islam-shia',
    'nrm-lds','nrm-jw','nrm-christian-science','nrm-adventist','nrm-other',
    'scholarly-critical','comparative-religion')),
  language_original text,
  translator        text,
  license_tier      char(1) not null check (license_tier in ('A','B','C','D')),
  license_note      text,
  source_url        text,
  embeddable        boolean not null default false,
  authority_class   text not null check (authority_class in (
    'scripture','ecumenical-definition','confessional-standard','magisterial',
    'authoritative-teacher','representative-theologian','popular-expression',
    'individual-opinion')),
  created_at        timestamptz default now()
);

-- ============ CHUNKS ============
create table concord_chunks (
  csid          text primary key,
  work_id       text not null references concord_works(id),
  locator       text not null,
  body          text not null,
  body_norm     text not null,                 -- normalized for byte-verification
  token_count   int not null,
  source_type   text not null check (source_type in
    ('primary','secondary','scholarly','polemic','irenic')),
  stance        text not null check (stance in
    ('self-descriptive','critical','neutral')),
  parent_csid   text,
  prev_csid     text,
  next_csid     text,
  scripture_refs text[] not null default '{}', -- normalized refs cited within this chunk
  embedding     vector(1024),
  fts           tsvector generated always as (to_tsvector('english', body)) stored
);

create index concord_chunks_embedding_idx on concord_chunks
  using hnsw (embedding vector_cosine_ops);
create index concord_chunks_fts_idx on concord_chunks using gin (fts);
create index concord_chunks_work_idx on concord_chunks (work_id);
create index concord_chunks_refs_idx on concord_chunks using gin (scripture_refs);

-- Constitutional constraint (N5): Tier C/D text can never land here.
-- Postgres does not allow subqueries in CHECK constraints, so the spec's
-- check is implemented as a trigger with identical semantics. Also guards
-- against a work being downgraded to C/D while chunks exist.
create or replace function concord_forbid_restricted_text()
returns trigger language plpgsql as $$
declare tier char(1);
begin
  select license_tier into tier from concord_works where id = new.work_id;
  if tier is null then
    raise exception 'concord_chunks.work_id % has no concord_works row', new.work_id;
  end if;
  if tier not in ('A','B') then
    raise exception 'Tier % text may never be stored in concord_chunks (work %)',
      tier, new.work_id;
  end if;
  return new;
end $$;

create trigger concord_chunks_no_restricted_text
  before insert or update on concord_chunks
  for each row execute function concord_forbid_restricted_text();

create or replace function concord_forbid_tier_downgrade()
returns trigger language plpgsql as $$
begin
  if new.license_tier not in ('A','B')
     and exists (select 1 from concord_chunks where work_id = new.id) then
    raise exception 'Cannot set work % to tier %: stored chunks exist. Delete them first.',
      new.id, new.license_tier;
  end if;
  return new;
end $$;

create trigger concord_works_no_tier_downgrade
  before update of license_tier on concord_works
  for each row execute function concord_forbid_tier_downgrade();

-- ============ CANON INDEX ============
-- Deterministic reference validator backing. Every real verse, one row.
-- Seeded from data/canon/verse-counts.json by scripts/build-canon.ts.
create table concord_canon (
  ref_norm  text primary key,                  -- 'john:3.16'
  book      text not null,
  chapter   int not null,
  verse     int not null,
  canon_set text[] not null                    -- protestant|catholic|orthodox|tanakh
);

create index concord_canon_book_idx on concord_canon (book, chapter);

-- ============ CITATION AUDIT ============
-- Not optional telemetry: the evidence that the 100% claim is true (§14).
create table concord_citation_log (
  id             uuid primary key default gen_random_uuid(),
  study_id       uuid not null,
  turn_id        uuid not null,
  csid           text not null,
  claim_text     text not null,
  retrieved      boolean not null,             -- was it in the retrieval set?
  entailment     text not null check (entailment in ('pass','partial','fail')),
  quote_verified boolean,                      -- null if not a quotation
  action         text not null check (action in ('rendered','stripped','regenerated')),
  created_at     timestamptz default now()
);

create index concord_citation_log_turn_idx on concord_citation_log (turn_id);
create index concord_citation_log_created_idx on concord_citation_log (created_at);

-- ============ NRM DUAL-AXIS PROFILE (§7.4) ============
-- The axes are orthogonal. Never display axis 1 and axis 2 in the same
-- visual component.
create table concord_movement_profile (
  tradition            text primary key,
  -- Axis 1: theological distance from historic creedal orthodoxy.
  -- Assessed against Nicene/Chalcedonian formulations. Cited, not asserted.
  theological_axis     text check (theological_axis in
    ('creedal','heterodox','non-trinitarian','non-christian')),
  theological_sources  text[],                 -- CSIDs supporting the assessment
  -- Axis 2: documented coercive-control findings in the academic literature.
  -- Independent of axis 1.
  control_axis         text check (control_axis in
    ('no-findings','contested','documented-findings')),
  control_sources      text[],                 -- CSIDs, scholarly only
  -- Axis 3: how the movement's own scholars describe it.
  self_description     text,
  self_sources         text[]
);
