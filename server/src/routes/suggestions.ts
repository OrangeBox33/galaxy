// Возможные друзья. Список считается на клиенте: весь граф у него уже есть,
// и после «Связать» подсказки пересчитываются без похода на сервер. Серверу
// остаётся помнить отказы и выданную добивку: обе должны пережить переустановку.
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

	router.post('/hub', rateLimit('suggest_hub', 60), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const targetId = bigint(reqBody(req).targetId, 'targetId');

			if (targetId === userId) {
				throw conflict('self_hub', 'Нельзя предложить самого себя');
			}
			if (!(await db.user.findUnique({ where: { id: targetId }, select: { id: true } }))) {
				throw notFound('Пользователь не найден');
			}

			const recorded = await db.$transaction(async (tx) => {
				// Окно показывает до трёх карточек сразу, запросы приходят наперегонки.
				await tx.$executeRaw`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`;
				const key = { userId_targetId: { userId, targetId } };
				if (await tx.suggestionHub.findUnique({ where: key })) return true;
				const { hubLimit } = await tx.user.findUniqueOrThrow({
					where: { id: userId },
					select: { hubLimit: true },
				});
				if ((await tx.suggestionHub.count({ where: { userId } })) >= hubLimit) return false;
				await tx.suggestionHub.create({ data: { userId, targetId } });
				return true;
			});
			if (!recorded) throw conflict('hub_limit', 'Добивка исчерпана');

			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
