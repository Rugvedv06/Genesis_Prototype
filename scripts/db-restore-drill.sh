#!/bin/sh
set -eu

archive_path=${1:?Usage: scripts/db-restore-drill.sh BACKUP.dump [healr_restore_NAME]}
restore_db=${2:-"healr_restore_$(date -u +%Y%m%d_%H%M%S)"}
if [ ! -f "$archive_path" ] || [ ! -s "$archive_path" ]; then
  echo "Backup archive is missing or empty" >&2
  exit 2
fi
if ! printf '%s' "$restore_db" | grep -Eq '^healr_restore_[A-Za-z0-9_]{1,48}$'; then
  echo "Restore target must begin with healr_restore_ and contain only letters, digits, or underscores" >&2
  exit 2
fi
docker compose exec -T -e RESTORE_DB="$restore_db" postgres sh -c 'createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
docker compose exec -T -e RESTORE_DB="$restore_db" postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --no-owner --no-privileges' < "$archive_path"
RESTORE_DATABASE_NAME="$restore_db" node api-server/src/db/verify-restore.js
echo "Restore drill complete; isolated database retained for inspection: $restore_db"
