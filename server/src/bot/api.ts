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

// Ссылка startapp, а не кнопка web_app: та открывает обычный режим, а полный
// экран из BotFather действует только на запуск основного Mini App.
// from доезжает до входа в start_param и говорит аналитике, откуда открыли карту.
export function openMapKeyboard(from: 'notify' | 'welcome') {
	return {
		inline_keyboard: [
			[{ text: '🌌 Открыть карту', url: `https://t.me/${env.botUsername}?startapp=${from}` }],
		],
	};
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
	const [first] = await profilePhotoIds(userId, 1);
	return first ? fileUrl(first) : null;
}

// file_id самого крупного размера каждого фото, от свежего к старому.
export async function profilePhotoIds(userId: bigint, limit: number): Promise<string[]> {
	const photos = (await call('getUserProfilePhotos', {
		user_id: Number(userId),
		limit,
	})) as { photos?: { file_id: string }[][] };

	return (photos.photos ?? [])
		.filter((sizes) => sizes.length > 0)
		.map((sizes) => sizes[sizes.length - 1].file_id);
}

// В адресе токен бота: наружу он не отдаётся, только скачивается сервером.
export async function fileUrl(fileId: string): Promise<string | null> {
	const file = (await call('getFile', { file_id: fileId })) as { file_path?: string };
	if (!file.file_path) return null;
	return `${BASE.replace('/bot', '/file/bot')}/${file.file_path}`;
}

export async function setWebhook(url: string): Promise<void> {
	await call('setWebhook', { url, allowed_updates: ['message'], drop_pending_updates: true });
}

export async function getWebhookInfo(): Promise<unknown> {
	return call('getWebhookInfo', {});
}
