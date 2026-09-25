#!/usr/bin/env bash
#
# Дамп боевой базы к себе в dumps/.
#
#   ./dump.sh            dumps/galaxy-2026-09-25-2043.dump
#   ./dump.sh <файл>     в указанный файл
#
# Развернуть обратно: pg_restore -c -d "<строка подключения>" <файл>
#
set -euo pipefail

REMOTE="${GALAXY_REMOTE:-root@193.124.203.221}"
ENV_FILE="${GALAXY_REMOTE_DIR:-/root/dev/galaxy/dist}/.env"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$ROOT/dumps/galaxy-$(date +%F-%H%M).dump}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m    %s\033[0m\n' "$*"; }
die() {
	printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2
	exit 1
}

mkdir -p "$(dirname "$OUT")"

# Пишем через .part: оборванный ssh не должен оставить обрубок под именем дампа.
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT

say "Снимаю дамп с $REMOTE"

# pg_dump работает на сервере, сюда течёт уже готовый файл: наружу PostgreSQL
# не слушает. DATABASE_URL берётся из того же .env, что у приложения.
ssh "$REMOTE" "set -eu
	DB_URL=\$(grep -E '^DATABASE_URL=' $ENV_FILE | head -1 | cut -d= -f2-)
	[ -n \"\$DB_URL\" ] || { echo 'нет DATABASE_URL в $ENV_FILE' >&2; exit 1; }
	pg_dump -Fc \"\$DB_URL\"
" >"$TMP" || die "дамп не снялся"

# -Fc начинается с PGDMP: без проверки сюда лёг бы любой мусор из stdout.
[ "$(head -c 5 "$TMP")" = "PGDMP" ] || die "это не дамп pg_dump -Fc"

mv "$TMP" "$OUT"
trap - EXIT

ok "$OUT"
ok "$(du -h "$OUT" | cut -f1)"
