// Разбор тел запросов. zod и любые другие библиотеки схемной валидации в проекте
// запрещены (раздел 2.8), поэтому здесь набор маленьких функций: каждая либо
// возвращает приведённое значение, либо бросает BadRequest с кодом поля.
//
// Правило: каждый маршрут разбирает тело явно, поле за полем, в начале обработчика.
// `req.body as SomeType` — это не валидация, а её имитация.
import { BadRequest } from './errors.js';

export function str(
	v: unknown,
	field: string,
	opts: { min?: number; max?: number; trim?: boolean } = {},
): string {
	if (typeof v !== 'string') {
		throw new BadRequest(field, 'invalid_field', `Поле ${field} должно быть строкой`);
	}
	const value = opts.trim === false ? v : v.trim();
	const min = opts.min ?? 0;
	if (value.length < min) {
		throw new BadRequest(field, 'too_short', `Поле ${field} короче ${min} символов`);
	}
	if (opts.max !== undefined && value.length > opts.max) {
		throw new BadRequest(field, 'too_long', `Поле ${field} длиннее ${opts.max} символов`);
	}
	return value;
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
	// Из формы число может прийти строкой — это нормально, лишь бы оно было целым.
	const value = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new BadRequest(field, 'invalid_field', `Поле ${field} должно быть целым числом`);
	}
	if (opts.min !== undefined && value < opts.min) {
		throw new BadRequest(field, 'out_of_range', `Поле ${field} меньше ${opts.min}`);
	}
	if (opts.max !== undefined && value > opts.max) {
		throw new BadRequest(field, 'out_of_range', `Поле ${field} больше ${opts.max}`);
	}
	return value;
}

// Идентификаторы Telegram не влезают в Number без потерь, поэтому по проводу они
// всегда ходят строками. Отрицательные разрешены: это тестовые пользователи.
export function bigint(v: unknown, field: string): bigint {
	const raw = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v;
	if (typeof raw !== 'string' || !/^-?\d{1,19}$/.test(raw.trim())) {
		throw new BadRequest(field, 'invalid_field', `Поле ${field} должно быть числовым id`);
	}
	try {
		return BigInt(raw.trim());
	} catch {
		throw new BadRequest(field, 'invalid_field', `Поле ${field} должно быть числовым id`);
	}
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
	if (typeof v !== 'string' || !allowed.includes(v as T)) {
		throw new BadRequest(field, 'invalid_field', `Поле ${field} имеет недопустимое значение`);
	}
	return v as T;
}

export function bool(v: unknown, field: string): boolean {
	if (typeof v === 'boolean') return v;
	if (v === 'true') return true;
	if (v === 'false') return false;
	throw new BadRequest(field, 'invalid_field', `Поле ${field} должно быть true или false`);
}

// null и undefined превращаются в null; всё остальное отдаётся разбирающей функции.
// Так поля профиля можно и задать, и очистить, не путая «не менять» с «стереть».
export function optional<T>(v: unknown, fn: () => T): T | null {
	if (v === null || v === undefined || v === '') return null;
	return fn();
}

// Есть ли ключ в теле вообще: отличает «поле не прислали» от «прислали null».
export function has(body: unknown, field: string): boolean {
	return typeof body === 'object' && body !== null && field in (body as Record<string, unknown>);
}

export function body(req: { body?: unknown }): Record<string, unknown> {
	const value = req.body;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new BadRequest('body', 'invalid_body', 'Тело запроса должно быть JSON-объектом');
	}
	return value as Record<string, unknown>;
}
