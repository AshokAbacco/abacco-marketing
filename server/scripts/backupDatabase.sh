#!/usr/bin/env bash
# scripts/backupDatabase.sh — nightly PostgreSQL backup with retention.
#
#   ./scripts/backupDatabase.sh                    # uses $DATABASE_URL
#   BACKUP_DIR=/var/backups ./scripts/backupDatabase.sh
#   ./scripts/backupDatabase.sh --verify           # also test-restores the dump
#
# Needs pg_dump from the PostgreSQL client tools (same major version as the
# server, 16 here):  Ubuntu: apt install postgresql-client-16
#                    Windows: installed with PostgreSQL, or use pgAdmin
#
# Schedule it daily (Linux cron, 2 AM):
#   0 2 * * * cd /path/to/server && ./scripts/backupDatabase.sh >> logs/backup.log 2>&1
#
# NOTE: if your database is hosted (Render, Neon, Supabase …) it probably
# has automatic backups already. Keep this one too: a second copy that you
# control protects you from account problems, and it is the only copy you
# can test-restore whenever you like.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/abacco-$STAMP.dump"

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f .env ]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "⛔ DATABASE_URL is not set (and not found in .env)" >&2
  exit 1
fi

command -v pg_dump >/dev/null || { echo "⛔ pg_dump not found — install the PostgreSQL client tools" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

echo "📦 Backing up to $FILE"
# -Fc = compressed custom format (restore with pg_restore, supports parallel)
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✅ Backup complete ($SIZE)"

if [ "${1:-}" = "--verify" ]; then
  TMP_DB="abacco_restore_test_$STAMP"
  echo "🔎 Test-restoring into $TMP_DB …"
  BASE_URL="${DATABASE_URL%/*}"
  psql "$BASE_URL/postgres" -q -c "CREATE DATABASE \"$TMP_DB\""
  pg_restore --dbname="$BASE_URL/$TMP_DB" --no-owner --no-privileges "$FILE" >/dev/null
  TABLES="$(psql "$BASE_URL/$TMP_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  psql "$BASE_URL/postgres" -q -c "DROP DATABASE \"$TMP_DB\""
  echo "✅ Restore test passed ($TABLES tables)"
fi

# Retention
DELETED="$(find "$BACKUP_DIR" -name 'abacco-*.dump' -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
[ "$DELETED" -gt 0 ] && echo "🧹 Removed $DELETED backup(s) older than $RETENTION_DAYS days"

echo "ℹ️  Restore with:  pg_restore --dbname=\"\$DATABASE_URL\" --clean --no-owner \"$FILE\""
