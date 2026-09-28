// Окно 1 минута, счётчики в памяти процесса — он всё равно ровно один.
import type { NextFunction, Request, Response } from 'express';
import { tooMany } from './errors.js';
import { readSession } from '../auth/session.js';
import { isAdmin } from '../env.js';
import { log } from './log.js';
import { describeUsers, visitorsLine, visitorsOf } from './visitors.js';

const WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number; reported?: boolean };
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
		const id = req.userId ?? readSession(req);
		if (id !== null && isAdmin(id)) {
			next();
			return;
		}
		const who = id?.toString() ?? req.ip ?? 'unknown';
		const key = `${name}:${who}`;
		const now = Date.now();
		const bucket = buckets.get(key);

		if (!bucket || bucket.resetAt <= now) {
			buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
			next();
			return;
		}
		if (bucket.count >= limit) {
			if (!bucket.reported) {
				bucket.reported = true;
				void reportLimit(name, limit, id, who, req.method, req.baseUrl + req.path);
			}
			next(tooMany());
			return;
		}
		bucket.count += 1;
		next();
	};
}

async function reportLimit(
	name: string,
	limit: number,
	id: bigint | null,
	who: string,
	method: string,
	path: string,
): Promise<void> {
	let title = who;
	let detail: string | undefined;
	try {
		if (id !== null) {
			title = (await describeUsers([id])).get(id) ?? who;
		} else {
			const ids = visitorsOf(who);
			detail = visitorsLine(ids, await describeUsers(ids));
		}
	} catch {
		// Без имени оповещение всё равно нужно.
	}
	log.error({ method, path, detail }, `упёрся в лимит ${name} (${limit} в минуту): ${title}`);
}

// Общий предел на все изменяющие запросы; отдельные маршруты строже.
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
