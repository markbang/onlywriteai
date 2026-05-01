#!/usr/bin/env bash
set -euo pipefail

database="${DATABASE_URL:-apps/api/data/onlywrite.sqlite}"
backup_dir="${BACKUP_DIR:-backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="${backup_dir}/onlywrite-${timestamp}.sqlite"

mkdir -p "${backup_dir}"

if [ ! -f "${database}" ]; then
  echo "Database not found: ${database}" >&2
  exit 1
fi

sqlite3 "${database}" ".backup '${backup_path}'"
sqlite3 "${backup_path}" "pragma integrity_check;"
echo "Created ${backup_path}"
