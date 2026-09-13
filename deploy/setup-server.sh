#!/usr/bin/env bash
#
# Разовая настройка сервера под galaxy. Запускается через ./deploy.sh --setup,
# который кладёт этот файл на сервер и выполняет его там.
# Идемпотентен: повторный запуск ничего не пересоздаёт и не ломает.
# Чужие процессы (kvadrat, textbin) не трогает ни при каких обстоятельствах.
#
# Отдельным файлом, а не heredoc'ом в ssh: при `bash -s` скрипт читается
# из stdin, и любая команда, читающая stdin (apt, psql), съедает его остаток —
# bash молча доходит до EOF и завершается на середине настройки.
set -euo pipefail
if command -v psql >/dev/null 2>&1; then
	echo "    PostgreSQL уже установлен: $(psql --version)"
else
	echo "    Ставлю PostgreSQL 16 из архива PGDG"
	# Основной репозиторий PGDG больше не собирает пакеты под Ubuntu 20.04
	# (focal EOL с мая 2025), поэтому берём сборки из архива. При переезде
	# на Ubuntu 24 достаточно поменять здесь хост и кодовое имя на noble-pgdg.
	export DEBIAN_FRONTEND=noninteractive
	# Список PGDG переписываем до общего update: неверный файл, оставшийся
	# от прошлой попытки, уронил бы apt-get update целиком.
	rm -f /etc/apt/sources.list.d/pgdg.list
	apt-get update -qq
	apt-get install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
	install -d /usr/share/postgresql-common/pgdg
	curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
		-o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
	echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt-archive.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
		> /etc/apt/sources.list.d/pgdg.list
	apt-get update -qq -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/pgdg.list \
		-o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
	apt-get install -y -qq postgresql-16 postgresql-contrib-16 >/dev/null
	echo "    Поставлен: $(psql --version)"
fi

systemctl enable --now postgresql >/dev/null 2>&1 || true
echo "    Кодировка кластера: $(sudo -u postgres psql -tAc 'SHOW server_encoding;')"

# Кластер общесерверный: у каждого проекта своя роль и своя база.
# Приложение никогда не подключается суперпользователем postgres.
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='galaxy'" | grep -q 1; then
	echo "    Роль galaxy уже есть, пароль не трогаю"
else
	# hex, а не base64: в base64 попадаются / + =, которые пришлось бы
	# процентно-экранировать в DATABASE_URL, и однажды кто-нибудь забудет.
	PGPASS="$(openssl rand -hex 24)"
	sudo -u postgres psql -qc "CREATE ROLE galaxy LOGIN PASSWORD '$PGPASS';" >/dev/null
	echo "    Создана роль galaxy. Пароль (записать в .env и больше нигде не хранить):"
	echo ""
	echo "        $PGPASS"
	echo ""
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='galaxy'" | grep -q 1; then
	echo "    База galaxy уже есть"
else
	sudo -u postgres psql -qc "CREATE DATABASE galaxy OWNER galaxy ENCODING 'UTF8';" >/dev/null
	echo "    Создана база galaxy"
fi

# Доступ только с localhost. Порт наружу не открывать.
LISTEN="$(sudo -u postgres psql -tAc 'SHOW listen_addresses;')"
echo "    listen_addresses = $LISTEN"
case "$LISTEN" in
	localhost | 127.0.0.1) ;;
	*) echo "    ВНИМАНИЕ: listen_addresses смотрит шире localhost — проверьте postgresql.conf" ;;
esac
if grep -vE '^\s*#|^\s*$' /etc/postgresql/*/main/pg_hba.conf | grep -qE '0\.0\.0\.0/0|::/0'; then
	echo "    ВНИМАНИЕ: в pg_hba.conf есть строки с внешними подсетями"
fi

# Еженедельный бэкап только нашей базы: бэкапы будущих проектов должны быть
# независимы от нашего. База крошечная, чаще смысла нет.
CRON_LINE='0 4 * * 0 /root/dev/galaxy/backup.sh'
if crontab -l 2>/dev/null | grep -qF '/root/dev/galaxy/backup.sh'; then
	echo "    Крон бэкапа уже настроен"
else
	(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
	echo "    Крон бэкапа добавлен: воскресенье, 4:00"
fi
