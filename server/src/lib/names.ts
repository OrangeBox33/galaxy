import { BadRequest } from './errors.js';
import { NAME_MAX, NAME_MIN } from '../../../shared/config.js';

// «Невидимки», которыми можно испортить вёрстку или подделать чужое имя.
// Чистим ПРИ СОХРАНЕНИИ, а не при выводе.
const INVISIBLE = /[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/g;

const EMOJI_RUN = /(?:\p{Extended_Pictographic}\uFE0F?){3,}/u;

export function cleanName(raw: string, field = 'displayName'): string {
	const value = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
	if (value.length < NAME_MIN) {
		throw new BadRequest(field, 'too_short', 'Имя не может быть пустым');
	}
	if (value.length > NAME_MAX) {
		throw new BadRequest(field, 'too_long', `Имя длиннее ${NAME_MAX} символов`);
	}
	if (EMOJI_RUN.test(value)) {
		throw new BadRequest(field, 'too_many_emoji', 'Слишком много эмодзи подряд');
	}
	return value;
}

// Имена из Telegram не отвергаем, а приводим к пригодному виду.
export function sanitizeIncoming(raw: string | null | undefined): string | null {
	if (typeof raw !== 'string') return null;
	const value = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
	return value === '' ? null : value;
}

type NameSource = {
	id: bigint;
	customName: string | null;
	telegramFirstName: string | null;
	telegramLastName: string | null;
	telegramUsername: string | null;
};

// Каскад имени: источник истины — сервер, клиент его не вычисляет.
export function displayName(user: NameSource): string {
	if (user.customName && user.customName.trim() !== '') return user.customName.trim();

	const parts = [user.telegramFirstName, user.telegramLastName]
		.map((part) => (part ?? '').trim())
		.filter((part) => part !== '');
	if (parts.length > 0) return parts.join(' ');

	if (user.telegramUsername && user.telegramUsername.trim() !== '') {
		return `@${user.telegramUsername.trim()}`;
	}
	return String(user.id);
}
