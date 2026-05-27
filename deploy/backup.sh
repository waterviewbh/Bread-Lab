#!/usr/bin/env bash
# Bread Lab — automated database backup
#
# Creates a compressed pg_dump and uploads it to S3-compatible object storage.
# A 7-day retention sweep deletes backups older than the cutoff.
# No user data is written to disk permanently — the dump file is removed on exit.
#
# Typically run by .github/workflows/db-backup.yml on a daily schedule.
# Can also be run locally:
#
#   export DATABASE_URL="postgres://..."
#   export BACKUP_S3_BUCKET="s3://bread-lab-backups"
#   export AWS_ACCESS_KEY_ID="..."
#   export AWS_SECRET_ACCESS_KEY="..."
#   export AWS_REGION="us-east-1"                  # or "auto" for Cloudflare R2
#   # Optional — only needed for non-AWS providers:
#   export AWS_ENDPOINT_URL="https://..."
#   bash deploy/backup.sh
#
# Required env vars:
#   DATABASE_URL          — PostgreSQL connection string
#   BACKUP_S3_BUCKET      — S3 bucket URI, e.g. s3://bread-lab-backups
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#   AWS_REGION
#
# Optional env vars:
#   AWS_ENDPOINT_URL      — custom endpoint for Backblaze B2, Cloudflare R2, etc.
#   BACKUP_RETENTION_DAYS — how many days to keep backups (default: 7)
#   BACKUP_STORAGE_CLASS  — S3 storage class (default: unset, uses provider default)
#                           AWS S3 users can set STANDARD_IA for cheaper infrequent-access
#                           pricing. Leave unset for Backblaze B2, Cloudflare R2, and other
#                           S3-compatible providers that don't support storage class flags.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required (e.g. s3://bread-lab-backups)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

TIMESTAMP="$(date -u '+%Y-%m-%d-%H-%M-%S')"
DUMP_FILE="/tmp/bread-lab-backup-${TIMESTAMP}.dump"

# Ensure the temp file is always cleaned up, even on error
trap 'rm -f "$DUMP_FILE"' EXIT

# Build the common aws CLI argument list
AWS_ARGS=()
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
  AWS_ARGS+=(--endpoint-url "$AWS_ENDPOINT_URL")
fi

echo "=== Bread Lab database backup ==="
echo "  Timestamp : $TIMESTAMP"
echo "  Destination: ${BACKUP_S3_BUCKET}/bread-lab-backup-${TIMESTAMP}.dump"
echo "  Retention  : ${RETENTION_DAYS} days"
echo ""

# ── Step 1: pg_dump ────────────────────────────────────────────────────────────
echo "→ [1/3] Dumping database..."
pg_dump \
  --no-owner \
  --no-acl \
  --format=custom \
  --compress=9 \
  --table=users \
  --table=feed_sessions \
  --table=bake_sessions \
  --table=recipes \
  "$DATABASE_URL" \
  > "$DUMP_FILE"

DUMP_SIZE="$(du -sh "$DUMP_FILE" | cut -f1)"
echo "    Dump complete. Size: ${DUMP_SIZE}"

# ── Step 2: Upload to S3 ───────────────────────────────────────────────────────
echo ""
echo "→ [2/3] Uploading to ${BACKUP_S3_BUCKET}..."
UPLOAD_ARGS=("${AWS_ARGS[@]}")
if [ -n "${BACKUP_STORAGE_CLASS:-}" ]; then
  UPLOAD_ARGS+=(--storage-class "$BACKUP_STORAGE_CLASS")
fi
aws s3 cp "${UPLOAD_ARGS[@]}" \
  "$DUMP_FILE" \
  "${BACKUP_S3_BUCKET}/bread-lab-backup-${TIMESTAMP}.dump" 2>&1
echo "    Upload complete."

# ── Step 3: Retention sweep ────────────────────────────────────────────────────
echo ""
echo "→ [3/3] Applying ${RETENTION_DAYS}-day retention policy..."

CUTOFF_EPOCH="$(date -u -d "${RETENTION_DAYS} days ago" '+%s' 2>/dev/null \
  || date -u -v "-${RETENTION_DAYS}d" '+%s')"  # macOS fallback

DELETED=0
while IFS= read -r line; do
  # aws s3 ls output: "2025-01-01 03:00:00   12345 bread-lab-backup-..."
  FILE_DATE="$(echo "$line" | awk '{print $1, $2}')"
  FILE_NAME="$(echo "$line" | awk '{print $4}')"

  if [ -z "$FILE_NAME" ]; then continue; fi

  FILE_EPOCH="$(date -u -d "$FILE_DATE" '+%s' 2>/dev/null \
    || date -u -j -f "%Y-%m-%d %H:%M:%S" "$FILE_DATE" '+%s' 2>/dev/null || echo 0)"

  if [ "$FILE_EPOCH" -lt "$CUTOFF_EPOCH" ]; then
    echo "    Deleting old backup: $FILE_NAME"
    aws s3 rm "${AWS_ARGS[@]}" "${BACKUP_S3_BUCKET}/${FILE_NAME}" 2>&1
    DELETED=$((DELETED + 1))
  fi
done < <(aws s3 ls "${AWS_ARGS[@]}" "${BACKUP_S3_BUCKET}/" 2>&1 | grep "bread-lab-backup-")

echo "    Retention sweep complete. Deleted: ${DELETED} old backup(s)."

echo ""
echo "✓ Backup successful: bread-lab-backup-${TIMESTAMP}.dump"
