// Вебхук Telegram. Секрет в пути сверяется через timingSafeEqual,
// несовпадение → 404 без подробностей (раздел 10).
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { log } from '../lib/log.js';
import { sendMessage } from '../bot/api.js';

function secretMatches(candidate: string): boolean {
	const a = Buffer.from(candidate);
	const b = Buffer.from(env.webhookSecret);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

const GREETING =
	'Привет! Это карта знакомств: звёздное небо, где каждый человек — звезда, ' +
	'а знакомства — линии между ними.\n\nОткрой карту и найди свою звезду.';

export function botRouter(): Router {
	const router = Router();

	router.post('/webhook/:secret', (req, res) => {
		if (!secretMatches(req.params.secret)) {
			res.status(404).end();
			return;
		}

		// Telegram обязан получить 200 в любом случае, иначе начнёт ретраить
		// апдейт по кругу. Поэтому отвечаем сразу, а обработку делаем следом.
		res.status(200).end();

		const update = req.body as {
			message?: { text?: string; chat?: { id?: number }; from?: { id?: number } };
		};
		const text = update?.message?.text ?? '';
		const chatId = update?.message?.chat?.id;
		// Обрабатываем только /start, остальное игнорируем.
		if (!chatId || !text.startsWith('/start')) return;

		void sendMessage(BigInt(chatId), GREETING, {
			inline_keyboard: [
				[{ text: '🌌 Открыть карту', web_app: { url: env.publicBaseUrl } }],
			],
		}).catch((err) => log.warn({ err }, 'не удалось ответить на /start'));
	});

	return router;
}
