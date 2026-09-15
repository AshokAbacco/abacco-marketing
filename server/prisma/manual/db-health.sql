-- ════════════════════════════════════════════════════════════════════════
-- Database health checks — run any time:
--   psql "$DATABASE_URL" -f prisma/manual/db-health.sql
-- ════════════════════════════════════════════════════════════════════════

-- 1) Connection budget: used vs allowed
SELECT current_setting('max_connections')::int AS max_connections,
       count(*)                                  AS in_use
FROM pg_stat_activity;

-- 2) Who holds connections (application_name is set by prismaClient.js)
SELECT application_name, state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2
ORDER BY 3 DESC;

-- 3) Largest tables (EmailMessage / CampaignRecipient are the usual suspects)
SELECT relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       n_live_tup AS rows,
       n_dead_tup AS dead_rows,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- 4) Tables scanned sequentially a lot (missing-index candidates)
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 10;

-- 5) Long-running queries right now
SELECT pid, now() - query_start AS runtime, state, left(query, 120) AS query
FROM pg_stat_activity
WHERE state <> 'idle' AND query_start < now() - interval '5 seconds'
ORDER BY runtime DESC;

-- 6) Slowest statements overall (requires the pg_stat_statements extension:
--    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;)
-- SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time) AS mean_ms,
--        left(query, 120) AS query
-- FROM pg_stat_statements
-- ORDER BY total_exec_time DESC
-- LIMIT 15;

-- 7) Half-built indexes left by an interrupted CONCURRENTLY build
SELECT c.relname AS invalid_index
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE NOT i.indisvalid;
