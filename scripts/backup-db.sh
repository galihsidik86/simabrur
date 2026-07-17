#!/usr/bin/env bash
# Backup PostgreSQL Safar (Linux/macOS): ./scripts/backup-db.sh [container] [user] [db]
set -euo pipefail
CONTAINER="${1:-safar-db}"
DB_USER="${2:-safar}"
DB_NAME="${3:-safar}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT_DIR="$(dirname "$0")/../backups"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/safar-$STAMP.dump"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f /tmp/safar-backup.dump
docker cp "$CONTAINER:/tmp/safar-backup.dump" "$OUT_FILE"
docker exec "$CONTAINER" rm -f /tmp/safar-backup.dump
echo "Backup tersimpan: $OUT_FILE"
