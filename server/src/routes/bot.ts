import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { env, isAdmin } from '../env.js';
import { log } from '../lib/log.js';
import { randomFlame } from '../lib/flame.js';
import { sanitizeIncoming } from '../lib/names.js';
import { ensureInviteToken, linkByToken } from '../lib/inviteLink.js';
import { OPEN_MAP_KEYBOARD, sendMessage } from '../bot/api.js';
import { AVATAR_TTL_MS, scheduleAvatarFetch } from '../avatars/queue.js';
import { markLayoutDirty } from '../layout/state.js';

function secretMatches(candidate: string): boolean {
	const a = Buffer.from(candidate);
	const b = Buffer.from(env.webhookSecret);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

const GREETING =
	'Привет! Это карта знакомств: звёздное небо, где каждый человек — звезда, ' +
	'а знакомства — линии между ними.\n\nОткрой карту и найди свою звезду.';

type From = {
	id?: number;
	username?: string;
	first_name?: string;
	last_name?: string;
	language_code?: string;
};

// Звезда зажигается здесь, а не при первом входе в приложение: start_param
// Mini App'у, открытому кнопкой из чата, уже не достаётся, и связать пришедшего
// с пригласившим позже было бы не по чему.
async function welcome(from: From, token: string): Promise<void> {
	const id = BigInt(from.id!);
	const isNew = (await db.user.count({ where: { id } })) === 0;
	const fields = {
		telegramUsername: from.username ?? null,
		telegramFirstName: sanitizeIncoming(from.first_name),
		telegramLastName: sanitizeIncoming(from.last_name),
		languageCode: from.language_code ?? null,
	};

	const user = await db.$transaction(async (tx) => {
		const saved = await tx.user.upsert({
			where: { id },
			create: { id, flame: randomFlame(), ...fields },
			update: fields,
		});
		if (saved.isBlocked) return saved;

		await ensureInviteToken(tx, saved);
		if (isNew) await markLayoutDirty(tx);
		if (token) await linkByToken(tx, saved.id, token);
		return saved;
	});

	if (user.isBlocked) return;

	const stale =
		user.avatarFetchedAt === null ||
		Date.now() - user.avatarFetchedAt.getTime() > AVATAR_TTL_MS;
	if (stale) scheduleAvatarFetch(user.id, null);
}

type Message = Record<string, unknown> & {
	text?: string;
	chat?: { id?: number };
	from?: From;
};

// Разведка под холодный старт: что Telegram отдаёт о человеке, если переслать
// боту его сообщение. Видит только админ.
function forwardReport(message: Message): string | null {
	const fields = Object.fromEntries(
		Object.entries(message).filter(([key]) => key.startsWith('forward_') || key === 'contact'),
	);
	if (Object.keys(fields).length === 0) return null;
	const json = JSON.stringify(fields, null, 2)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<pre>${json}</pre>`;
}

export function botRouter(): Router {
	const router = Router();

	router.post('/webhook/:secret', (req, res) => {
		if (!secretMatches(req.params.secret)) {
			res.status(404).end();
			return;
		}

		// Telegram обязан получить 200, иначе начнёт ретраить апдейт по кругу.
		res.status(200).end();

		const message = (req.body as { message?: Message })?.message;
		const text = message?.text ?? '';
		const chatId = message?.chat?.id;
		const from = message?.from;
		if (!chatId) return;

		if (from?.id && isAdmin(BigInt(from.id))) {
			const report = forwardReport(message!);
			if (report) {
				void sendMessage(BigInt(chatId), report).catch((err) =>
					log.warn({ err }, 'не удалось разобрать пересланное'),
				);
				return;
			}
		}

		if (!text.startsWith('/start')) return;

		if (from?.id) {
			const token = text.slice('/start'.length).trim().split(/\s/)[0] ?? '';
			void welcome(from, token).catch((err) =>
				log.warn(
					{ err, userId: String(from.id) },
					'не удалось завести пришедшего по /start',
				),
			);
		}

		void sendMessage(BigInt(chatId), GREETING, OPEN_MAP_KEYBOARD).catch((err) => log.warn({ err }, 'не удалось ответить на /start'));
	});

	return router;
}
