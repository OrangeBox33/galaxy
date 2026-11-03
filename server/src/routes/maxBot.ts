import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { log } from '../lib/log.js';
import { randomFlame } from '../lib/flame.js';
import { sanitizeIncoming } from '../lib/names.js';
import { ensureInviteToken, linkByToken } from '../lib/inviteLink.js';
import {
	isFromMax,
	MAX_ID_OFFSET,
	maxDialogAvatar,
	maxOpenMapButtons,
	maxWebhookSecret,
	sendMaxMessage,
} from '../bot/max.js';
import { AVATAR_TTL_MS, scheduleAvatarFetch } from '../avatars/queue.js';
import { markLayoutDirty } from '../layout/state.js';
import { GREETING } from './bot.js';

function secretMatches(candidate: string | undefined): boolean {
	if (!candidate) return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(maxWebhookSecret);
	return a.length === b.length && timingSafeEqual(a, b);
}

type MaxUser = {
	user_id?: number;
	first_name?: string;
	last_name?: string | null;
	is_bot?: boolean;
};

type BotStarted = {
	update_type?: string;
	chat_id?: number;
	user?: MaxUser;
	payload?: string | null;
	user_locale?: string | null;
};

// Как /start в Telegram: звезда загорается до первого входа в приложение,
// а связь с пригласившим берётся из payload ссылки max.ru/<бот>?start=<токен>.
async function welcome(update: BotStarted): Promise<void> {
	const maxId = BigInt(update.user!.user_id!);
	const fields = {
		telegramFirstName: sanitizeIncoming(update.user!.first_name),
		telegramLastName: sanitizeIncoming(update.user!.last_name),
		languageCode: update.user_locale ?? null,
	};

	const { user, isNew } = await db.$transaction(async (tx) => {
		const existing = await tx.user.findUnique({ where: { maxId }, select: { id: true } });
		const isNew = existing === null;
		const saved = await tx.user.upsert({
			where: { maxId },
			create: { id: MAX_ID_OFFSET + maxId, maxId, flame: randomFlame(), ...fields },
			update: existing && !isFromMax(existing.id) ? {} : fields,
		});
		if (saved.isBlocked) return { user: saved, isNew };

		await ensureInviteToken(tx, saved);
		if (isNew) await markLayoutDirty(tx);
		if (update.payload) await linkByToken(tx, saved.id, update.payload);
		return { user: saved, isNew };
	});

	if (user.isBlocked || !isFromMax(user.id)) return;

	const stale =
		isNew ||
		user.avatarFetchedAt === null ||
		Date.now() - user.avatarFetchedAt.getTime() > AVATAR_TTL_MS;
	if (stale && update.chat_id) {
		const url = await maxDialogAvatar(update.chat_id);
		if (url) scheduleAvatarFetch(user.id, url);
	}
}

export function maxBotRouter(): Router {
	const router = Router();

	router.post('/webhook', (req, res) => {
		if (!secretMatches(req.get('X-Max-Bot-Api-Secret'))) {
			res.status(403).end();
			return;
		}

		// Макс ждёт ответа не дольше 30 с и при молчании снимает подписку.
		res.status(200).end();

		const update = req.body as BotStarted;
		const user = update?.user;
		if (update?.update_type !== 'bot_started' || !user?.user_id || user.is_bot) return;

		void welcome(update).catch((err) =>
			log.warn({ err, maxId: String(user.user_id) }, 'не удалось завести пришедшего из Макса'),
		);

		void sendMaxMessage(BigInt(user.user_id), GREETING, maxOpenMapButtons('welcome')).catch(
			(err) => log.warn({ err }, 'не удалось ответить на «Начать» в Максе'),
		);
	});

	return router;
}
