// Связи (раздел 6.4). Связь создаётся мгновенно, без подтверждения второй
// стороны: она узнаёт о ней из уведомления бота и может в любой момент развязать.
import { Router } from 'express';
import { MAX_LINKS_PER_USER } from '../../../shared/config.js';
import { db } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { displayName } from '../lib/names.js';
import { normalizePair } from '../lib/pair.js';
import { rateLimit } from '../lib/rateLimit.js';
import { bigint, body as reqBody } from '../lib/validate.js';
import { enqueue, escapeHtml } from '../bot/outbox.js';
import { markLayoutDirty } from '../layout/state.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';

async function countLinks(userId: bigint): Promise<number> {
	return db.link.count({ where: { OR: [{ aId: userId }, { bId: userId }] } });
}

export function linksRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.post('/', rateLimit('links', 30), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const parsed = reqBody(req);
			const targetId = bigint(parsed.targetId, 'targetId');

			if (targetId === userId) {
				throw conflict('self_link', 'Нельзя связаться с самим собой');
			}
			const target = await db.user.findUnique({ where: { id: targetId } });
			if (!target) throw notFound('Пользователь не найден');
			if (target.isBlocked) throw forbidden('Пользователь заблокирован');

			if ((await countLinks(userId)) >= MAX_LINKS_PER_USER) {
				throw conflict('too_many_links', 'Достигнут предел числа связей');
			}

			const [aId, bId] = normalizePair(userId, targetId);
			if (await db.link.findUnique({ where: { aId_bId: { aId, bId } } })) {
				throw conflict('link_exists', 'Связь уже есть');
			}

			await db.$transaction(async (tx) => {
				await tx.link.create({ data: { aId, bId, createdById: userId } });
				await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
				await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });

				const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
				await enqueue(
					tx,
					targetId,
					'linked',
					`✨ <b>${escapeHtml(displayName(me))}</b> отметил(а) знакомство с тобой на карте.`,
				);
				await markLayoutDirty(tx);
			});

			res.status(201).json({ ok: true });
		} catch (err) {
			next(err);
		}
	});

	router.delete('/:targetId', rateLimit('unlink', 60), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const targetId = bigint(req.params.targetId, 'targetId');
			const [aId, bId] = normalizePair(userId, targetId);

			const link = await db.link.findUnique({ where: { aId_bId: { aId, bId } } });
			if (!link) throw notFound('Связи нет');

			await db.$transaction(async (tx) => {
				await tx.link.delete({ where: { id: link.id } });
				await tx.user.update({ where: { id: aId }, data: { degree: { decrement: 1 } } });
				await tx.user.update({ where: { id: bId }, data: { degree: { decrement: 1 } } });
				await markLayoutDirty(tx);
			});

			// Уведомление при разрыве намеренно не отправляется:
			// разрыв связи — приватное действие.
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
