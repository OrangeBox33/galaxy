// Ограничение частоты по id пользователя. Окно 1 минута, счётчики в памяти
// процесса — его всё равно ровно один (раздел 14).
import type { NextFunction, Request, Response } from 'express';
import { tooMany } from './errors.js';
import { readSession } from '../auth/session.js';

const WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Чистка раз в минуту, чтобы карта не росла бесконечно на редких посетителях.
setInterval(() => {
	const now = Date.now();
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) buckets.delete(key);
	}
}, WINDOW_MS).unref();

export function rateLimit(name: string, limit: number) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		// Считаем по пользователю; для запросов до входа (сам вход) — по адресу.
		const who = (req.userId ?? readSession(req))?.toString() ?? req.ip ?? 'unknown';
		const key = `${name}:${who}`;
		const now = Date.now();
		const bucket = buckets.get(key);

		if (!bucket || bucket.resetAt <= now) {
			buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
			next();
			return;
		}
		if (bucket.count >= limit) {
			next(tooMany());
			return;
		}
		bucket.count += 1;
		next();
	};
}

// Общий предел на все изменяющие запросы (раздел 14): 60 в минуту.
// Отдельные маршруты сверх этого ограничены строже.
export function mutationRateLimit() {
	const limiter = rateLimit('mutate', 60);
	return (req: Request, res: Response, next: NextFunction): void => {
		if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
			limiter(req, res, next);
			return;
		}
		next();
	};
}
