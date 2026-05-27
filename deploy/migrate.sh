#!/usr/bin/env bash
# Bread Lab — database migration helper
#
# Dumps the Replit PostgreSQL database and restores it to a new provider.
# Data is streamed directly between source and target — nothing is written to disk.
# No user data is stored in this script or in the repository.
#
# Prerequisites: psql and pg_dump installed locally
#   macOS:  brew install libpq && brew link --force libpq
#   Debian: apt install postgresql-client
#
# Usage:
#   export DATABASE_URL="postgres://..."        # Replit source (from Replit secrets)
#   export NEW_DATABASE_URL="postgres://..."    # New host target
#   bash deploy/migrate.sh
#
# After migration:
#   1. Set DATABASE_URL and SESSION_SECRET on the new host
#   2. Deploy the API server (see Dockerfile / railway.json / render.yaml / fly.toml)
#   3. Confirm: curl https://<new-host>/api/healthz
#   4. Update bread-lab.clanmcmains.com DNS CNAME to new host
#   5. Confirm: curl https://bread-lab.clanmcmains.com/api/healthz

set -euo pipefail

SOURCE_URL="${DATABASE_URL:?Set DATABASE_URL to the Replit source database}"
TARGET_URL="${NEW_DATABASE_URL:?Set NEW_DATABASE_URL to the destination database}"

TABLES=(users feed_sessions bake_sessions recipes)

count_rows() {
  local url="$1"
  local table="$2"
  psql "$url" -t -A -c "SELECT COUNT(*) FROM $table;" 2>/dev/null
}

echo "=== Bread Lab database migration ==="
echo ""

echo "→ [1/4] Applying schema to target database..."
psql "$TARGET_URL" -f "$(dirname "$0")/schema.sql"
echo "    Schema applied."

echo ""
echo "→ [2/4] Streaming data from source to target..."
echo "    Tables: ${TABLES[*]}"
pg_dump \
  --no-owner \
  --no-acl \
  --data-only \
  --column-inserts \
  --table=users \
  --table=feed_sessions \
  --table=bake_sessions \
  --table=recipes \
  "$SOURCE_URL" \
  | psql "$TARGET_URL"
echo "    Data imported."

echo ""
echo "→ [3/4] Verifying row counts (source vs target)..."
echo ""
printf "  %-20s %10s %10s %10s\n" "table" "source" "target" "match"
printf "  %-20s %10s %10s %10s\n" "-----" "------" "------" "-----"

MISMATCH=0
for tbl in "${TABLES[@]}"; do
  src=$(count_rows "$SOURCE_URL" "$tbl")
  tgt=$(count_rows "$TARGET_URL" "$tbl")
  if [ "$src" = "$tgt" ]; then
    status="✓"
  else
    status="✗ MISMATCH"
    MISMATCH=1
  fi
  printf "  %-20s %10s %10s %10s\n" "$tbl" "$src" "$tgt" "$status"
done

echo ""
if [ "$MISMATCH" -ne 0 ]; then
  echo "✗ Row count mismatch detected. Do NOT proceed with DNS cutover."
  echo "  Investigate the mismatched tables above before continuing."
  exit 1
fi

echo "✓ All row counts match. Migration verified."
echo ""
echo "  Next steps:"
echo "  1. Deploy API server to new host, set DATABASE_URL + SESSION_SECRET"
echo "  2. Confirm: curl https://<new-host>/api/healthz"
echo "  3. Update bread-lab.clanmcmains.com CNAME to new host"
echo "  4. Confirm: curl https://bread-lab.clanmcmains.com/api/healthz"
