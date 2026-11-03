import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { randomFlame } from '../lib/flame.js';
import { db } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { str, body as reqBody } from '../lib/validate.js';
import { track } from '../lib/analytics.js';
import { sanitizeIncoming } from '../lib/names.js';
import { ensureInviteToken, linkByToken } from '../lib/inviteLink.js';
import { toProfile } from '../lib/views.js';
import { type InitData, verifyInitData, verifyMaxInitData } from '../auth/initData.js';
import { clearSession, issueSession } from '../auth/session.js';
import { markLayoutDirty } from '../layout/state.js';
import { AVATAR_TTL_MS, scheduleAvatarFetch } from '../avatars/queue.js';
import { isFromMax, MAX_ID_OFFSET } from '../bot/max.js';

async function enter(
	req: Request,
	res: Response,
	verify: (raw: string) => InitData | null,
	fromMax: boolean,
): Promise<void> {
	const parsed = reqBody(req);
	const raw = str(parsed.initData, 'initData', { min: 1, trim: false });
	// Аналитика вход не ломает: кривые поля просто не учитываются.
	const platform = typeof parsed.platform === 'string' ? parsed.platform.slice(0, 32) : undefined;

	// Ошибка на любом шаге проверки — 401 без подробностей в теле.
	const data = verify(raw);
	if (!data) throw unauthorized();

	// ?from= — у кнопок web_app в уже отправленных сообщениях.
	const source = data.startParam ?? parsed.from;
	const from = source === 'notify' || source === 'welcome' ? source : null;

	const person = data.user;
	const where: Prisma.UserWhereUniqueInput = fromMax ? { maxId: person.id } : { id: person.id };
	const fields = {
		// username из Макса не храним: кнопка в карточке звезды ведёт в Telegram.
		telegramUsername: fromMax ? null : person.username,
		telegramFirstName: sanitizeIncoming(person.firstName),
		telegramLastName: sanitizeIncoming(person.lastName),
		languageCode: person.languageCode,
		platform,
	};
	const existing = await db.user.findUnique({ where, select: { id: true } });
	const isNew = existing === null;
	const merged = fromMax && existing !== null && !isFromMax(existing.id);

	const user = await db.$transaction(async (tx) => {
		const saved = await tx.user.upsert({
			where,
			create: {
				...(fromMax ? { id: MAX_ID_OFFSET + person.id, maxId: person.id } : { id: person.id }),
				// Множитель языков пламени выдаётся один раз, здесь.
				flame: randomFlame(),
				...fields,
			},
			update: merged ? { platform, lastSeenAt: new Date() } : { ...fields, lastSeenAt: new Date() },
		});

		if (saved.isBlocked) return saved;

		await ensureInviteToken(tx, saved);
		if (isNew) await markLayoutDirty(tx);

		// Ссылки ведут в чат с ботом, и там же человек заводится и связывается.
		// start_param остаётся ради старых ссылок из чужих переписок.
		if (data.startParam && !from) await linkByToken(tx, saved.id, data.startParam);
		await track(tx, saved.id, 'visit', from ?? (data.startParam ? 'link' : 'direct'));

		return tx.user.findUniqueOrThrow({ where: { id: saved.id } });
	});

	if (user.isBlocked) throw forbidden('Доступ закрыт');

	// Аватарку тянем фоном: ответ на вход она задерживать не должна.
	const stale =
		user.avatarFetchedAt === null || Date.now() - user.avatarFetchedAt.getTime() > AVATAR_TTL_MS;
	if (person.photoUrl && stale && !merged) scheduleAvatarFetch(user.id, person.photoUrl);

	issueSession(res, user.id);
	res.json(toProfile(user));
}

export function authRouter(): Router {
	const router = Router();

	router.post('/telegram', (req, res, next) => {
		enter(req, res, verifyInitData, false).catch(next);
	});

	router.post('/max', (req, res, next) => {
		enter(req, res, verifyMaxInitData, true).catch(next);
	});

	router.post('/logout', (_req, res) => {
		clearSession(res);
		res.status(204).end();
	});

	return router;
}
