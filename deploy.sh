#!/usr/bin/env bash
#
# Деплой galaxy на прод одной командой.
#
#   ./deploy.sh              собрать клиент + сервер, залить, накатить миграции, перезапустить
#   ./deploy.sh --setup      разовая настройка: pm2, автозапуск, PostgreSQL, каталог avatars, крон бэкапа
#   ./deploy.sh --migrate    только накатить миграции
#   ./deploy.sh --logs       живые логи (pm2 logs)
#   ./deploy.sh --status     что крутится на сервере
#   ./deploy.sh --restart    перезапустить, ничего не собирая
#   ./deploy.sh --no-build   залить уже собранное
#   ./deploy.sh --fast       не ставить зависимости и не трогать миграции
#   ./deploy.sh --full       поставить зависимости и накатить миграции принудительно
#   ./deploy.sh --dry-run    показать, что бы залилось
#
# По умолчанию тяжёлые шаги выполняются, только если для них что-то изменилось:
# зависимости — при изменении package-lock.json, генерация клиента Prisma —
# при изменении schema.prisma, миграции — при появлении новых файлов миграций.
# Слепки этих файлов хранятся на сервере, поэтому обычный выкат занимает секунды.
#
# Раскладка на сервере:
#   /root/dev/galaxy/
#     ├── avatars/              ВНЕ dist: переживает деплой, в rsync не участвует
#     └── dist/
#         ├── server/src/       скомпилированный сервер (точка входа server/src/index.js)
#         ├── shared/           общий код, включая config.js с BASE_PATH
#         ├── public/           собранный клиент (vite build с base '/galaxy/')
#         ├── prisma/           схема и миграции: на сервере выполняется migrate deploy
#         ├── package.json      + package-lock.json, ecosystem.config.cjs
#         ├── .env              создан вручную, в rsync не участвует
#         └── node_modules/     ставится на сервере через npm, не заливается

set -euo pipefail

REMOTE="${GALAXY_REMOTE:-root@193.124.203.221}"
REMOTE_DIR="${GALAXY_REMOTE_DIR:-/root/dev/galaxy/dist}"
REMOTE_HOME_DIR="$(dirname "$REMOTE_DIR")"
APP_NAME="galaxy"
PUBLIC_URL="https://kvadratnikitosa.ru/galaxy"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE="$ROOT/.deploy"

# node/npm/pm2 на сервере стоят через nvm, а неинтерактивный ssh не читает профиль,
# поэтому каждую удалённую команду начинаем с подгрузки nvm.
REMOTE_ENV='export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh";'

BUILD=1
DRY_RUN=0
MODE="deploy"
# auto — решать по контрольным суммам, fast — пропустить всё, full — сделать всё.
HEAVY="auto"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m    %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die() {
	printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2
	exit 1
}

remote() { ssh "$REMOTE" "$REMOTE_ENV $*"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--setup) MODE="setup" ;;
		--migrate) MODE="migrate" ;;
		--logs) MODE="logs" ;;
		--status) MODE="status" ;;
		--restart) MODE="restart" ;;
		--no-build) BUILD=0 ;;
		--fast) HEAVY="fast" ;;
		--full) HEAVY="full" ;;
		--dry-run) DRY_RUN=1 ;;
		-h | --help)
			sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) die "неизвестный аргумент: $1" ;;
	esac
	shift
done

# ── Разовая настройка сервера ──────────────────────────────────────────────
# Идемпотентна: повторный запуск ничего не ломает и ничего не пересоздаёт.
# Чужие процессы (kvadrat, textbin) не трогает ни при каких обстоятельствах.
if [ "$MODE" = "setup" ]; then
	say "Настраиваю сервер $REMOTE"

	remote 'command -v pm2 >/dev/null || npm install -g pm2'
	ok "pm2 на месте: $(remote 'pm2 -v' | tail -1)"

	say "Каталоги проекта"
	remote "mkdir -p $REMOTE_HOME_DIR/avatars $REMOTE_DIR /root/backups"
	ok "$REMOTE_HOME_DIR/avatars и $REMOTE_DIR готовы"

	say "PostgreSQL, каталоги и крон"
	scp -q "$ROOT/deploy/setup-server.sh" "$REMOTE:$REMOTE_HOME_DIR/setup-server.sh"
	remote "chmod 700 $REMOTE_HOME_DIR/setup-server.sh && $REMOTE_HOME_DIR/setup-server.sh"

	say "Скрипт резервного копирования"
	# Отдельным файлом, а не строкой в кроне: в кроне пароль был бы виден в crontab -l.
	scp -q "$ROOT/deploy/backup.sh" "$REMOTE:$REMOTE_HOME_DIR/backup.sh"
	remote "chmod 700 $REMOTE_HOME_DIR/backup.sh"
	ok "$REMOTE_HOME_DIR/backup.sh"

	say "Автозапуск pm2 после ребута"
	remote 'pm2 startup systemd -u root --hp /root' | tail -3
	ok "готово"

	printf '\n\033[1;33mОсталось создать %s/.env вручную:\033[0m\n\n' "$REMOTE_DIR"
	cat <<ENVTPL
DATABASE_URL=postgresql://galaxy:<пароль>@127.0.0.1:5432/galaxy
PORT=3005
PUBLIC_BASE_URL=$PUBLIC_URL
TELEGRAM_BOT_TOKEN=<токен от BotFather>
TELEGRAM_BOT_USERNAME=<имя бота без @>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
SESSION_SECRET=<openssl rand -hex 32>
ADMIN_TELEGRAM_IDS=<ваш telegram id>
AVATAR_DIR=$REMOTE_HOME_DIR/avatars
LAYOUT_RECOMPUTE_DEBOUNCE_MS=4000
ENVTPL
	printf '\n\033[1;32mСервер готов. Дальше: ./deploy.sh\033[0m\n'
	exit 0
fi

if [ "$MODE" = "logs" ]; then
	say "Логи $APP_NAME (Ctrl+C чтобы выйти)"
	# -t: интерактивный tty, иначе Ctrl+C не дойдёт до pm2
	ssh -t "$REMOTE" "$REMOTE_ENV pm2 logs $APP_NAME --lines 100"
	exit 0
fi

if [ "$MODE" = "status" ]; then
	remote "pm2 list && pm2 info $APP_NAME | head -25"
	exit 0
fi

if [ "$MODE" = "restart" ]; then
	say "Перезапускаю $APP_NAME"
	remote "cd $REMOTE_DIR && pm2 startOrRestart ecosystem.config.cjs --update-env && pm2 list"
	exit 0
fi

if [ "$MODE" = "migrate" ]; then
	say "Накатываю миграции"
	remote "cd $REMOTE_DIR && npx prisma migrate deploy"
	exit 0
fi

# ── Сборка ─────────────────────────────────────────────────────────────────
if [ "$BUILD" = "1" ]; then
	say "Собираю клиент (vite)"
	(cd "$ROOT/web" && npm run build)

	say "Собираю сервер (tsc)"
	# Старый dist сносим: rootDir у сервера — корень репо, и от прежних
	# раскладок в dist могли остаться файлы, которых уже нет в исходниках.
	rm -rf "$ROOT/server/dist"
	(cd "$ROOT/server" && npm run build)
fi

[ -f "$ROOT/web/dist/index.html" ] || die "нет web/dist/index.html — клиент не собран (убери --no-build)"
[ -f "$ROOT/server/dist/server/src/index.js" ] || die "нет server/dist/server/src/index.js — сервер не собран"
[ -f "$ROOT/server/dist/shared/config.js" ] || die "нет server/dist/shared/ — проверь include в server/tsconfig.json"

# Забытый base в vite.config.ts — это белый экран на проде: бандл уходит
# запрашивать /assets/* и получает соседнее приложение домена. Ловим здесь.
grep -q 'src="/galaxy/assets/' "$ROOT/web/dist/index.html" \
	|| die "в web/dist/index.html ссылки на ассеты не начинаются с /galaxy/ — проверь base в vite.config.ts"

# ── Раскладываем в точности то, что должно лежать на сервере ───────────────
say "Готовлю посылку в $STAGE"

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -R "$ROOT/server/dist/server" "$STAGE/server"
cp -R "$ROOT/server/dist/shared" "$STAGE/shared"
cp -R "$ROOT/web/dist" "$STAGE/public"          # собранный клиент -> dist/public на сервере
cp -R "$ROOT/server/prisma" "$STAGE/prisma"     # схема и миграции: на сервере migrate deploy
cp "$ROOT/deploy/ecosystem.config.cjs" "$STAGE/ecosystem.config.cjs"
cp "$ROOT/server/package-lock.json" "$STAGE/package-lock.json"

# package.json берём серверный и правим два скрипта:
# start — путь до точки входа в развёрнутом дереве;
# postinstall — @prisma/client без кодогенерации нерабочий, а генерировать его
# нужно там же, где ставятся зависимости, то есть на сервере.
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
pkg.scripts = {
	start: "node server/src/index.js",
	postinstall: "prisma generate",
};
delete pkg.devDependencies;
fs.writeFileSync(process.argv[2], JSON.stringify(pkg, null, "\t") + "\n");
' "$ROOT/server/package.json" "$STAGE/package.json"

ok "$(find "$STAGE" -type f | wc -l | tr -d ' ') файлов"

# ── Заливаем ───────────────────────────────────────────────────────────────
RSYNC_OPTS=(
	-az --delete --human-readable --itemize-changes
	# node_modules живёт на сервере (ставится npm), .env создан вручную.
	# Оба исключены и из заливки, и из --delete.
	--exclude 'node_modules'
	--exclude '.env'
	--exclude '.DS_Store'
)

if [ "$DRY_RUN" = "1" ]; then
	say "Пробный прогон (ничего не меняем) -> $REMOTE:$REMOTE_DIR"
	rsync "${RSYNC_OPTS[@]}" --dry-run "$STAGE/" "$REMOTE:$REMOTE_DIR/"
	exit 0
fi

say "Заливаю на $REMOTE:$REMOTE_DIR"
rsync "${RSYNC_OPTS[@]}" "$STAGE/" "$REMOTE:$REMOTE_DIR/"

# ── Тяжёлые шаги: только если для них что-то изменилось ────────────────
# Слепок того, что уже сделано на сервере, лежит вне dist — rsync его не трогает.
STATE_FILE="$REMOTE_HOME_DIR/.deploy-state"

hash_file() { shasum -a 256 "$1" | cut -d' ' -f1; }
hash_dir() {
	find "$1" -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1
}

LOCK_HASH="$(hash_file "$ROOT/server/package-lock.json")"
SCHEMA_HASH="$(hash_file "$ROOT/server/prisma/schema.prisma")"
MIGRATIONS_HASH="$(hash_dir "$ROOT/server/prisma/migrations")"

REMOTE_STATE="$(ssh "$REMOTE" "cat $STATE_FILE 2>/dev/null || true")"
state_value() { printf '%s\n' "$REMOTE_STATE" | sed -n "s/^$1=//p" | head -1; }

NEED_INSTALL=0
NEED_GENERATE=0
NEED_MIGRATE=0

case "$HEAVY" in
	full)
		NEED_INSTALL=1
		NEED_MIGRATE=1
		;;
	fast) ;;
	*)
		[ "$(state_value lock)" = "$LOCK_HASH" ] || NEED_INSTALL=1
		[ "$(state_value schema)" = "$SCHEMA_HASH" ] || NEED_GENERATE=1
		[ "$(state_value migrations)" = "$MIGRATIONS_HASH" ] || NEED_MIGRATE=1
		;;
esac

if [ "$NEED_INSTALL" = "1" ]; then
	say "Ставлю зависимости на сервере"
	# postinstall тут же сгенерирует клиент Prisma, отдельный шаг не нужен.
	remote "cd $REMOTE_DIR && npm install --omit=dev --no-audit --no-fund" | tail -3
elif [ "$NEED_GENERATE" = "1" ]; then
	say "Обновляю клиент Prisma (схема изменилась)"
	remote "cd $REMOTE_DIR && npx prisma generate" | tail -2
else
	ok "зависимости не менялись — пропускаю"
fi

# Миграции строго до перезапуска: перезапускать процесс на непринятой схеме
# бессмысленно. Если migrate deploy упал — прерываемся, не трогая pm2,
# и на сервере продолжает работать старая версия.
if [ "$NEED_MIGRATE" = "1" ]; then
	say "Накатываю миграции"
	remote "cd $REMOTE_DIR && npx prisma migrate deploy" | tail -5
else
	ok "новых миграций нет — пропускаю"
fi

# Слепок пишем только после успеха: если что-то упало выше, скрипт уже вышел
# по set -e, и в следующий раз шаг повторится.
remote "printf 'lock=%s\nschema=%s\nmigrations=%s\n' '$LOCK_HASH' '$SCHEMA_HASH' '$MIGRATIONS_HASH' > $STATE_FILE"

say "Перезапускаю $APP_NAME"
remote "cd $REMOTE_DIR && pm2 startOrRestart ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null && pm2 list"

say "Последние строки лога"
remote "pm2 logs $APP_NAME --lines 15 --nostream"

printf '\n\033[1;32mГотово: %s\033[0m\n' "$PUBLIC_URL"
printf 'Логи: ./deploy.sh --logs\n'
