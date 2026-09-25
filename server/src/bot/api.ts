import { env } from '../env.js';

const BASE = `https://api.telegram.org/bot${env.botToken}`;

export type TelegramError = Error & { code?: number; fatal?: boolean };

// Не сбой связи, а окончательный отказ: ретраить такое бессмысленно.
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

// Аватарка через Bot API, а не через photo_url из initData: у того публичный
// CDN обрезан на 320 px, здесь доступны все размеры, вплоть до 640. Работает
// только для тех, у кого с ботом есть чат, — то есть после «Запустить».
export async function profilePhotoUrl(userId: bigint): Promise<string | null> {
	const photos = (await call('getUserProfilePhotos', {
		user_id: Number(userId),
		limit: 1,
	})) as { photos?: { file_id: string }[][] };

	const sizes = photos.photos?.[0];
	if (!sizes?.length) return null;

	const file = (await call('getFile', { file_id: sizes[sizes.length - 1].file_id })) as {
		file_path?: string;
	};
	if (!file.file_path) return null;

	return `${BASE.replace('/bot', '/file/bot')}/${file.file_path}`;
}

export async function setWebhook(url: string): Promise<void> {
	await call('setWebhook', { url, allowed_updates: ['message'], drop_pending_updates: true });
}

export async function getWebhookInfo(): Promise<unknown> {
	return call('getWebhookInfo', {});
}
