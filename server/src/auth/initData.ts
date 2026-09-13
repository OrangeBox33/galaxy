// Проверка initData Telegram Mini App. Раздел 4.1 ТЗ — реализовано ровно по шагам.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

export type TelegramUser = {
	id: bigint;
	firstName: string | null;
	lastName: string | null;
	username: string | null;
	languageCode: string | null;
	photoUrl: string | null;
};

export type InitData = {
	user: TelegramUser;
	startParam: string | null;
	authDate: number;
};

const MAX_AGE_SEC = 24 * 60 * 60;

// Ключ — именно строка "WebAppData", сообщение — токен бота. Не наоборот:
// перепутанный порядок аргументов здесь самая частая ошибка.
const SECRET_KEY = createHmac('sha256', 'WebAppData').update(env.botToken).digest();

export function verifyInitData(raw: string, now = Date.now()): InitData | null {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) return null;

	const params = new URLSearchParams(raw);
	const hash = params.get('hash');
	if (!hash) return null;
	params.delete('hash');

	// Оставшиеся пары сортируем по ключу и склеиваем через \n в виде key=value.
	const pairs: string[] = [];
	for (const [key, value] of params.entries()) {
		pairs.push(`${key}=${value}`);
	}
	pairs.sort();
	const dataCheckString = pairs.join('\n');

	const computed = createHmac('sha256', SECRET_KEY).update(dataCheckString).digest('hex');
	if (!safeEqualHex(computed, hash)) return null;

	const authDate = Number(params.get('auth_date'));
	if (!Number.isFinite(authDate) || authDate <= 0) return null;
	if (Math.floor(now / 1000) - authDate > MAX_AGE_SEC) return null;

	const user = parseUser(params.get('user'));
	if (!user) return null;

	return {
		user,
		startParam: params.get('start_param'),
		authDate,
	};
}

function safeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
	} catch {
		return false;
	}
}

function parseUser(rawUser: string | null): TelegramUser | null {
	if (!rawUser) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawUser);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;

	const obj = parsed as Record<string, unknown>;
	const id = obj.id;
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;

	const text = (value: unknown): string | null =>
		typeof value === 'string' && value.trim() !== '' ? value : null;

	return {
		id: BigInt(id),
		firstName: text(obj.first_name),
		lastName: text(obj.last_name),
		username: text(obj.username),
		languageCode: text(obj.language_code),
		photoUrl: text(obj.photo_url),
	};
}
