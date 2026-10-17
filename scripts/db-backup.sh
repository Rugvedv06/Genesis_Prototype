#!/bin/sh
set -eu

backup_path=${1:-"backups/healr-$(date -u +%Y%m%dT%H%M%SZ).dump"}
backup_dir=$(dirname "$backup_path")
mkdir -p "$backup_dir"
if [ -e "$backup_path" ]; then
  echo "Refusing to overwrite existing backup: $backup_path" >&2
  exit 2
fi
tmp_path="$backup_path.tmp.$$"
trap 'rm -f "$tmp_path"' EXIT HUP INT TERM

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$tmp_path"
if [ ! -s "$tmp_path" ]; then
  echo "PostgreSQL produced an empty backup" >&2
  exit 1
fi
docker compose exec -T postgres sh -c 'pg_restore --list' < "$tmp_path" > /dev/null
mv "$tmp_path" "$backup_path"
trap - EXIT HUP INT TERM
echo "Backup written and archive-validated: $backup_path"
