// Свой профиль (раздел 5).
import { Router } from 'express';
import { AGE_MAX, AGE_MIN, GENDERS } from '../../../shared/config.js';
import { db } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { cleanName } from '../lib/names.js';
import { rateLimit } from '../lib/rateLimit.js';
import { toProfile } from '../lib/views.js';
import { has, int, oneOf, optional, str, body as reqBody } from '../lib/validate.js';
import { clearSession } from '../auth/session.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';
import { markLayoutDirty } from '../layout/state.js';

export function meRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.get('/', async (req, res, next) => {
		try {
			const user = await db.user.findUniqueOrThrow({ where: { id: req.userId! } });
			res.json(toProfile(user));
		} catch (err) {
			next(err);
		}
	});

	router.patch('/', rateLimit('me', 20), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const parsed = reqBody(req);
			const current = await db.user.findUniqueOrThrow({ where: { id: userId } });

			const data: {
				customName?: string;
				age?: number | null;
				gender?: (typeof GENDERS)[number];
			} = {};

			if (has(parsed, 'displayName')) {
				// Переименованный админом не может вернуть себе прежнее имя.
				if (current.nameLockedByAdmin) {
					throw forbidden('Имя изменено администратором');
				}
				data.customName = cleanName(str(parsed.displayName, 'displayName', { max: 64 }));
			}
			if (has(parsed, 'age')) {
				data.age = optional(parsed.age, () =>
					int(parsed.age, 'age', { min: AGE_MIN, max: AGE_MAX }),
				);
			}
			if (has(parsed, 'gender')) {
				data.gender = oneOf(parsed.gender, 'gender', GENDERS);
			}

			const user = await db.user.update({ where: { id: userId }, data });
			res.json(toProfile(user));
		} catch (err) {
			next(err);
		}
	});

	router.delete('/', async (req, res, next) => {
		try {
			// Связи и приглашения уходят каскадом за пользователем (раздел 3).
			await db.user.delete({ where: { id: req.userId! } });
			await markLayoutDirty();
			clearSession(res);
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
