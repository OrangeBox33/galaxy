// Весь граф одним запросом (раздел 10). Единственный тяжёлый эндпоинт;
// клиент кеширует ответ и перезапрашивает раз в 30 секунд, плюс немедленно
// после любого своего действия. WebSocket и SSE намеренно не используются.
import { Router } from 'express';
import { db } from '../db.js';
import { displayName } from '../lib/names.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';
import { getLayoutVersion } from '../layout/state.js';

export function graphRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.get('/', async (req, res, next) => {
		try {
			const userId = req.userId!;

			const [users, links, pending, layoutVersion] = await Promise.all([
				db.user.findMany({ orderBy: { id: 'asc' } }),
				db.link.findMany({ select: { aId: true, bId: true } }),
				// Чужие тусклые точки не отдаются никогда, даже админу.
				db.invite.findMany({
					where: { inviterId: userId, status: 'PENDING' },
					orderBy: { createdAt: 'asc' },
				}),
				getLayoutVersion(),
			]);

			res.json({
				layoutVersion,
				me: userId.toString(),
				nodes: users.map((user) => ({
					id: user.id.toString(),
					name: displayName(user),
					gender: user.gender,
					age: user.age,
					degree: user.degree,
					centrality: user.centrality,
					x: user.x,
					y: user.y,
					avatar: user.avatarFile,
					isTest: user.isTest,
					isBlocked: user.isBlocked,
				})),
				edges: links.map((link) => [link.aId.toString(), link.bId.toString()]),
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
