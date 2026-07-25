-- Retrieval RPCs backing lib/concord/retrieve.ts (spec §8.1).
-- Each returns chunks joined with the work metadata prompt assembly needs.

create or replace function concord_match_chunks(
  query_embedding vector(1024),
  match_count int default 60
) returns table (
  csid text, work_id text, locator text, body text, body_norm text,
  token_count int, source_type text, stance text,
  parent_csid text, prev_csid text, next_csid text, scripture_refs text[],
  tradition text, authority_class text, composed_era text, work_title text,
  score float
) language sql stable as $$
  select c.csid, c.work_id, c.locator, c.body, c.body_norm,
         c.token_count, c.source_type, c.stance,
         c.parent_csid, c.prev_csid, c.next_csid, c.scripture_refs,
         w.tradition, w.authority_class, w.composed_era, w.title,
         1 - (c.embedding <=> query_embedding) as score
  from concord_chunks c
  join concord_works w on w.id = c.work_id
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function concord_fts_chunks(
  query_text text,
  match_count int default 60
) returns table (
  csid text, work_id text, locator text, body text, body_norm text,
  token_count int, source_type text, stance text,
  parent_csid text, prev_csid text, next_csid text, scripture_refs text[],
  tradition text, authority_class text, composed_era text, work_title text,
  score float
) language sql stable as $$
  select c.csid, c.work_id, c.locator, c.body, c.body_norm,
         c.token_count, c.source_type, c.stance,
         c.parent_csid, c.prev_csid, c.next_csid, c.scripture_refs,
         w.tradition, w.authority_class, w.composed_era, w.title,
         ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text))::float as score
  from concord_chunks c
  join concord_works w on w.id = c.work_id
  where c.fts @@ websearch_to_tsquery('english', query_text)
  order by score desc
  limit match_count;
$$;

-- Exact scripture-reference containment: unbounded (§8.1).
create or replace function concord_ref_chunks(
  ref_norms text[]
) returns table (
  csid text, work_id text, locator text, body text, body_norm text,
  token_count int, source_type text, stance text,
  parent_csid text, prev_csid text, next_csid text, scripture_refs text[],
  tradition text, authority_class text, composed_era text, work_title text,
  score float
) language sql stable as $$
  select c.csid, c.work_id, c.locator, c.body, c.body_norm,
         c.token_count, c.source_type, c.stance,
         c.parent_csid, c.prev_csid, c.next_csid, c.scripture_refs,
         w.tradition, w.authority_class, w.composed_era, w.title,
         1.0::float as score
  from concord_chunks c
  join concord_works w on w.id = c.work_id
  where c.scripture_refs && ref_norms;
$$;

-- Scheduled compliance audit (§17.6): must always return zero rows.
create or replace function concord_audit_restricted_text()
returns table (csid text, work_id text, license_tier char(1))
language sql stable as $$
  select c.csid, c.work_id, w.license_tier
  from concord_chunks c
  join concord_works w on w.id = c.work_id
  where w.license_tier not in ('A','B');
$$;
