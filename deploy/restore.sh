#!/usr/bin/env bash
# Bread Lab — backup restore & verification
#
# Downloads a backup from S3, restores it to a target database, and verifies
# row counts match the dump's table of contents.
#
# Run this to:
#   a) Perform a real disaster recovery restore
#   b) Periodically verify that backups are valid and restorable (test restore)
#
# Usage:
#   # Restore the latest backup:
#   export DATABASE_URL="postgres://..."              # source (for row-count comparison)
#   export NEW_DATABASE_URL="postgres://..."          # restore target (can be a temp DB)
#   export BACKUP_S3_BUCKET="s3://bread-lab-backups"
#   export AWS_ACCESS_KEY_ID="..."
#   export AWS_SECRET_ACCESS_KEY="..."
#   export AWS_REGION="us-east-1"
#   bash deploy/restore.sh
#
#   # Restore a specific backup:
#   BACKUP_FILE="bread-lab-backup-2025-06-01-03-00-00.dump" bash deploy/restore.sh
#
# Exit code: 0 on success, 1 if row counts don't match or restore fails.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required (production DB for row-count comparison)}"
NEW_DATABASE_URL="${NEW_DATABASE_URL:?NEW_DATABASE_URL is required (restore target)}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

TABLES=(users feed_sessions bake_sessions recipes)
DUMP_FILE="/tmp/bread-lab-restore.dump"

trap 'rm -f "$DUMP_FILE"' EXIT

AWS_ARGS=()
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
  AWS_ARGS+=(--endpoint-url "$AWS_ENDPOINT_URL")
fi

count_rows() {
  local url="$1"
  local table="$2"
  psql "$url" -t -A -c "SELECT COUNT(*) FROM $table;" 2>/dev/null
}

echo "=== Bread Lab backup restore ==="
echo ""

# ── Step 1: Select backup ──────────────────────────────────────────────────────
if [ -n "${BACKUP_FILE:-}" ]; then
  SELECTED="$BACKUP_FILE"
  echo "→ [1/4] Using specified backup: $SELECTED"
else
  echo "→ [1/4] Finding latest backup in ${BACKUP_S3_BUCKET}..."
  SELECTED="$(aws s3 ls "${AWS_ARGS[@]}" "${BACKUP_S3_BUCKET}/" \
    | grep "bread-lab-backup-" \
    | sort | tail -1 | awk '{print $4}')"

  if [ -z "$SELECTED" ]; then
    echo "    No backups found in ${BACKUP_S3_BUCKET}"
    exit 1
  fi
  echo "    Selected: $SELECTED"
fi

# ── Step 2: Download ───────────────────────────────────────────────────────────
echo ""
echo "→ [2/4] Downloading ${SELECTED}..."
aws s3 cp "${AWS_ARGS[@]}" \
  "${BACKUP_S3_BUCKET}/${SELECTED}" \
  "$DUMP_FILE"
DUMP_SIZE="$(du -sh "$DUMP_FILE" | cut -f1)"
echo "    Downloaded. Size: ${DUMP_SIZE}"

# ── Step 3: Restore ────────────────────────────────────────────────────────────
echo ""
echo "→ [3/4] Applying schema to restore target..."
psql "$NEW_DATABASE_URL" -f "$(dirname "$0")/schema.sql"

echo "    Restoring data from dump..."
pg_restore \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  -d "$NEW_DATABASE_URL" \
  "$DUMP_FILE"
echo "    Restore complete."

# ── Step 4: Verify row counts ──────────────────────────────────────────────────
echo ""
echo "→ [4/4] Verifying row counts (production vs restored)..."
echo ""
printf "  %-20s %12s %12s %10s\n" "table" "production" "restored" "match"
printf "  %-20s %12s %12s %10s\n" "-----" "----------" "--------" "-----"

MISMATCH=0
for tbl in "${TABLES[@]}"; do
  prod=$(count_rows "$DATABASE_URL" "$tbl")
  rest=$(count_rows "$NEW_DATABASE_URL" "$tbl")
  if [ "$prod" = "$rest" ]; then
    status="✓"
  else
    status="✗ MISMATCH"
    MISMATCH=1
  fi
  printf "  %-20s %12s %12s %10s\n" "$tbl" "$prod" "$rest" "$status"
done

echo ""
if [ "$MISMATCH" -ne 0 ]; then
  echo "✗ Row count mismatch. The backup may be stale or the restore incomplete."
  exit 1
fi

echo "✓ Restore verified. All row counts match production."
echo ""
echo "  Backup file   : $SELECTED"
echo "  Restore target: $NEW_DATABASE_URL"
