// Весь граф одним запросом. Клиент перезапрашивает раз в 30 секунд
// и сразу после своего действия; WebSocket и SSE намеренно не используются.
import { Router } from 'express';
import { db } from '../db.js';
import { displayName } from '../lib/names.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';
import { getLayoutScale, getLayoutVersion } from '../layout/state.js';

export function graphRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.get('/', async (req, res, next) => {
		try {
			const userId = req.userId!;

			const [users, links, pending, dismissed, layoutVersion, layoutScale] = await Promise.all([
				db.user.findMany({ orderBy: { id: 'asc' } }),
				db.link.findMany({ select: { aId: true, bId: true } }),
				// Чужие тусклые точки не отдаются никогда, даже админу.
				db.invite.findMany({
					where: { inviterId: userId, status: 'PENDING' },
					orderBy: { createdAt: 'asc' },
				}),
				// Кого этот человек отклонил в окне возможных друзей: клиент
				// вычитает этот список из подсказок сам.
				db.suggestionDismissal.findMany({
					where: { userId },
					select: { targetId: true },
				}),
				getLayoutVersion(),
				getLayoutScale(),
			]);

			res.json({
				layoutVersion,
				layoutScale,
				me: userId.toString(),
				nodes: users.map((user) => ({
					id: user.id.toString(),
					name: displayName(user),
					gender: user.gender,
					age: user.age,
					degree: user.degree,
					flame: user.flame,
					centrality: user.centrality,
					x: user.x,
					y: user.y,
					avatar: user.avatarFile,
					coreColor: user.coreColor,
					flameColor: user.flameColor,
					isTest: user.isTest,
					isBlocked: user.isBlocked,
				})),
				edges: links.map((link) => [link.aId.toString(), link.bId.toString()]),
				dismissed: dismissed.map((row) => row.targetId.toString()),
				pending: pending.map((invite) => ({
					id: invite.id,
					token: invite.token,
					label: invite.label,
					createdAt: invite.createdAt.toISOString(),
				})),
			});
		} catch (err) {
			next(err);
		}
	});

	return router;
}
