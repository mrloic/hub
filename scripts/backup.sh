#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-local}"
case "$mode" in
  local) args=(-f compose.yaml) ;;
  production) args=(--env-file .env.production -f compose.production.yaml) ;;
  *) echo 'Использование: scripts/backup.sh [local|production]' >&2; exit 2 ;;
esac
umask 077
mkdir -p backups
file="backups/hub-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
# No password in argv, no roles/global objects or environment in the dump.
if docker compose "${args[@]}" exec -T db pg_dump -U hub -d hub -Fc > "$file.partial"; then
  mv "$file.partial" "$file"
  echo "Backup: $file"
else
  echo "Backup не завершён: $file.partial; рабочая БД не изменена." >&2
  exit 1
fi
