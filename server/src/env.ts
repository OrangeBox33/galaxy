// Чтение и проверка переменных окружения. Руками, без библиотек валидации (раздел 2.7 ТЗ).
// Падаем на старте, а не при первом запросе: тогда pm2 сразу покажет проблему в логе.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// .env лежит рядом с рабочей папкой процесса (/root/dev/galaxy/dist/.env) и в деплое
// не участвует. Node умеет читать его сам начиная с 20.6; если файла нет — значит,
// переменные пришли из окружения, это тоже нормально.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
	process.loadEnvFile(envFile);
}

function fail(message: string): never {
	// Без стека: в логе pm2 нужна одна внятная строка, а не портянка.
	console.error(`Galaxy не может стартовать: ${message}`);
	process.exit(1);
}

function str(name: string): string {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') {
		fail(`не задана переменная окружения ${name}`);
	}
	return raw.trim();
}

function num(name: string, fallback?: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') {
		if (fallback !== undefined) return fallback;
		fail(`не задана переменная окружения ${name}`);
	}
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		fail(`переменная окружения ${name} должна быть числом, а не «${raw}»`);
	}
	return value;
}

function bigintList(name: string): bigint[] {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') return [];
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '')
		.map((part) => {
			if (!/^-?\d+$/.test(part)) {
				fail(`переменная окружения ${name} содержит нечисловой id «${part}»`);
			}
			return BigInt(part);
		});
}

const adminIds = bigintList('ADMIN_TELEGRAM_IDS');
if (adminIds.length === 0) {
	fail('в ADMIN_TELEGRAM_IDS не задано ни одного администратора');
}

export const env = Object.freeze({
	databaseUrl: str('DATABASE_URL'),
	port: num('PORT', 3005),
	publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/+$/, ''),
	botToken: str('TELEGRAM_BOT_TOKEN'),
	botUsername: str('TELEGRAM_BOT_USERNAME').replace(/^@/, ''),
	webhookSecret: str('TELEGRAM_WEBHOOK_SECRET'),
	sessionSecret: str('SESSION_SECRET'),
	adminIds,
	avatarDir: str('AVATAR_DIR'),
	layoutDebounceMs: num('LAYOUT_RECOMPUTE_DEBOUNCE_MS', 4000),
	// Необязательное: где лежит собранный клиент. По умолчанию — public/ рядом с dist.
	publicDir: process.env.PUBLIC_DIR?.trim() || '',
	isProduction: process.env.NODE_ENV === 'production',
});

export function isAdmin(id: bigint): boolean {
	return env.adminIds.some((adminId) => adminId === id);
}
