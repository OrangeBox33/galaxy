import { Router } from 'express';
import { CLIENT_EVENTS, EVENTS_BATCH_MAX, type ClientEvent } from '../../../shared/analytics.js';
import { db } from '../db.js';
import { BadRequest } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { int, oneOf, body as reqBody } from '../lib/validate.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';

const TYPES = Object.keys(CLIENT_EVENTS) as ClientEvent[];
const SESSION_MAX_SEC = 24 * 60 * 60;

export function eventsRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	// Клиент шлёт пачку раз в 10 с и ещё одну при сворачивании: 20 в минуту с запасом.
	router.post('/', rateLimit('events', 20), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const list = reqBody(req).events;
			if (!Array.isArray(list) || list.length > EVENTS_BATCH_MAX) {
				throw new BadRequest('events', 'invalid_field', `Нужен список до ${EVENTS_BATCH_MAX} событий`);
			}

			const data = list.map((raw: unknown, index) => {
				const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
				const field = `events[${index}]`;
				const type = oneOf(item.type, `${field}.type`, TYPES);
				const allowed: readonly string[] = CLIENT_EVENTS[type];
				const detail =
					allowed.length === 0 ? null : oneOf(item.detail, `${field}.detail`, allowed);
				const value =
					type === 'session'
						? int(item.value, `${field}.value`, { min: 0, max: SESSION_MAX_SEC })
						: null;
				return { userId, type, detail, value };
			});

			if (data.length > 0) await db.analyticsEvent.createMany({ data });
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
