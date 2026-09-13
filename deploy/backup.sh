#!/usr/bin/env bash
#
# Еженедельный бэкап базы galaxy. Запускается кроном по воскресеньям в 4:00.
# Отдельным файлом, а не строкой в crontab: пароль не должен светиться в `crontab -l`.
# Дамп делается по базе galaxy, а не по всему кластеру: когда на сервере появятся
# другие проекты, их бэкапы должны быть независимы от нашего.
set -euo pipefail

ENV_FILE="/root/dev/galaxy/dist/.env"
OUT_DIR="/root/backups"
LOG="$OUT_DIR/galaxy-backup.log"
KEEP=4

mkdir -p "$OUT_DIR"

# DATABASE_URL берём из того же .env, что и приложение: один источник истины.
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$DB_URL" ] || {
	echo "$(date -Is) нет DATABASE_URL в $ENV_FILE" >>"$LOG"
	exit 1
}

STAMP="$(date +%F)"
pg_dump -Fc "$DB_URL" >"$OUT_DIR/galaxy-$STAMP.dump" 2>>"$LOG"

# Храним 4 последних (месяц истории), старые удаляем.
ls -1t "$OUT_DIR"/galaxy-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "$(date -Is) бэкап готов: galaxy-$STAMP.dump" >>"$LOG"
