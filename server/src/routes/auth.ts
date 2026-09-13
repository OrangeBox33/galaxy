// Вход через Telegram Mini App (раздел 4). Никаких паролей и форм:
// приложение открывается внутри Telegram и получает подписанный initData.
import { Router } from 'express';
import { db } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { str, body as reqBody } from '../lib/validate.js';
import { sanitizeIncoming } from '../lib/names.js';
import { toProfile } from '../lib/views.js';
import { verifyInitData } from '../auth/initData.js';
import { clearSession, issueSession } from '../auth/session.js';
import { acceptInvite } from './invites.js';
import { markLayoutDirty } from '../layout/state.js';
import { scheduleAvatarFetch } from '../avatars/queue.js';

// Аватарку обновляем не чаще раза в неделю: она меняется редко, а каждый вход
// иначе тянул бы файл с серверов Telegram.
const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function authRouter(): Router {
	const router = Router();

	router.post('/telegram', async (req, res, next) => {
		try {
			const parsed = reqBody(req);
			const raw = str(parsed.initData, 'initData', { min: 1, trim: false });

			// Ошибка на любом шаге проверки — 401 без подробностей в теле.
			const data = verifyInitData(raw);
			if (!data) throw unauthorized();

			const tg = data.user;
			const isNew = (await db.user.count({ where: { id: tg.id } })) === 0;

			const user = await db.$transaction(async (tx) => {
				const saved = await tx.user.upsert({
					where: { id: tg.id },
					create: {
						id: tg.id,
						telegramUsername: tg.username,
						telegramFirstName: sanitizeIncoming(tg.firstName),
						telegramLastName: sanitizeIncoming(tg.lastName),
						languageCode: tg.languageCode,
					},
					update: {
						telegramUsername: tg.username,
						telegramFirstName: sanitizeIncoming(tg.firstName),
						telegramLastName: sanitizeIncoming(tg.lastName),
						languageCode: tg.languageCode,
						lastSeenAt: new Date(),
					},
				});

				if (saved.isBlocked) return saved;

				if (isNew) await markLayoutDirty(tx);
				if (data.startParam) await acceptInvite(tx, saved.id, data.startParam);

				return tx.user.findUniqueOrThrow({ where: { id: saved.id } });
			});

			if (user.isBlocked) throw forbidden('Доступ закрыт');

			// Аватарку тянем фоном: ответ на вход она задерживать не должна.
			const stale =
				user.avatarFetchedAt === null ||
				Date.now() - user.avatarFetchedAt.getTime() > AVATAR_TTL_MS;
			if (tg.photoUrl && stale) scheduleAvatarFetch(user.id, tg.photoUrl);

			issueSession(res, user.id);
			res.json(toProfile(user));
		} catch (err) {
			next(err);
		}
	});

	router.post('/logout', (_req, res) => {
		clearSession(res);
		res.status(204).end();
	});

	return router;
}
