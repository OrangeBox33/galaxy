// Возможные друзья. Список считается на клиенте: весь граф у него уже есть,
// и после «Связать» подсказки пересчитываются без похода на сервер. Серверу
// остаётся помнить отказы, чтобы «Нет» пережило переустановку приложения.
import { Router } from 'express';
import { db } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { bigint, body as reqBody } from '../lib/validate.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';

export function suggestionsRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.post('/dismiss', rateLimit('dismiss', 60), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const targetId = bigint(reqBody(req).targetId, 'targetId');

			if (targetId === userId) {
				throw conflict('self_dismiss', 'Нельзя отказаться от самого себя');
			}
			if (!(await db.user.findUnique({ where: { id: targetId }, select: { id: true } }))) {
				throw notFound('Пользователь не найден');
			}

			// Повторное «Нет» — не ошибка: клиент мог не дождаться ответа.
			await db.suggestionDismissal.upsert({
				where: { userId_targetId: { userId, targetId } },
				create: { userId, targetId },
				update: {},
			});

			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
