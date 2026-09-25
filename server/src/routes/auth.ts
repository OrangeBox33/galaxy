import { Router } from 'express';
import { randomFlame } from '../lib/flame.js';
import { db } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { str, body as reqBody } from '../lib/validate.js';
import { sanitizeIncoming } from '../lib/names.js';
import { ensureInviteToken } from '../lib/inviteLink.js';
import { toProfile } from '../lib/views.js';
import { verifyInitData } from '../auth/initData.js';
import { clearSession, issueSession } from '../auth/session.js';
import { acceptInvite } from './invites.js';
import { markLayoutDirty } from '../layout/state.js';
import { AVATAR_TTL_MS, scheduleAvatarFetch } from '../avatars/queue.js';

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
						// Множитель языков пламени выдаётся один раз, здесь.
						flame: randomFlame(),
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

				await ensureInviteToken(tx, saved);
				if (isNew) await markLayoutDirty(tx);

				// Ссылки ведут в чат с ботом, и там же человек заводится и связывается.
				// start_param остаётся ради старых startapp-ссылок из чужих переписок.
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
