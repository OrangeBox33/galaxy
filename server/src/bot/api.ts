// Тонкая обёртка над Bot API. Никаких библиотек: нам нужны два метода.
import { env } from '../env.js';

const BASE = `https://api.telegram.org/bot${env.botToken}`;

export type TelegramError = Error & { code?: number; fatal?: boolean };

// «Пользователь не начинал диалог с ботом» и «бот заблокирован» — это не сбой
// связи, а окончательный отказ: ретраить такое бессмысленно (раздел 12).
function isFatal(description: string): boolean {
	const text = description.toLowerCase();
	return (
		text.includes('bot was blocked') ||
		text.includes("bot can't initiate conversation") ||
		text.includes('chat not found') ||
		text.includes('user is deactivated') ||
		text.includes('bot was kicked')
	);
}

async function call(method: string, payload: unknown): Promise<unknown> {
	const res = await fetch(`${BASE}/${method}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(10_000),
	});

	const data = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
	if (!data.ok) {
		const error = new Error(data.description ?? `ошибка ${res.status}`) as TelegramError;
		error.code = res.status;
		error.fatal = isFatal(data.description ?? '');
		throw error;
	}
	return data.result;
}

export async function sendMessage(
	chatId: bigint,
	text: string,
	replyMarkup?: unknown,
): Promise<void> {
	await call('sendMessage', {
		chat_id: Number(chatId),
		text,
		parse_mode: 'HTML',
		disable_web_page_preview: true,
		...(replyMarkup ? { reply_markup: replyMarkup } : {}),
	});
}

export async function setWebhook(url: string): Promise<void> {
	await call('setWebhook', { url, allowed_updates: ['message'], drop_pending_updates: true });
}

export async function getWebhookInfo(): Promise<unknown> {
	return call('getWebhookInfo', {});
}
