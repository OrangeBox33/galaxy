// Бот в Максе. Сертификат API выдан УЦ Минцифры: без NODE_EXTRA_CA_CERTS
// (deploy/ecosystem.config.cjs) Node в Макс не достучится.
import { createHmac } from 'node:crypto';
import { env } from '../env.js';
import { log } from '../lib/log.js';
import type { TelegramError } from './api.js';

const BASE = 'https://platform-api2.max.ru';

// id людей из Макса уходят за пределы Telegram-id: те укладываются в 52 бита
// с запасом на десятилетия, а это ещё в пределах точного числа JS.
export const MAX_ID_OFFSET = 1_000_000_000_000_000n;

// Склеенный с Telegram — телеграмная строка с maxId — остаётся телеграмным:
// туда уведомления, оттуда имя, аватарка и ссылка.
export function isFromMax(id: bigint): boolean {
	return id >= MAX_ID_OFFSET;
}

export const maxEnabled = env.maxBotToken !== '';

// Отдельной переменной нет: секрет выводится из токена и меняется вместе с ним.
export const maxWebhookSecret = createHmac('sha256', 'galaxy-max-webhook')
	.update(env.maxBotToken)
	.digest('hex');

let botName: string | null = null;

// Имя бота для ссылок и кнопки мини-приложения; известно после loadMaxBot.
export function maxBotName(): string | null {
	return botName;
}

async function call(
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	query: Record<string, string> = {},
	body?: unknown,
): Promise<unknown> {
	const url = new URL(path, BASE);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

	const res = await fetch(url, {
		method,
		// Голый токен, без Bearer.
		headers: {
			Authorization: env.maxBotToken,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(10_000),
	});

	const data = (await res.json().catch(() => ({}))) as { message?: string };
	if (!res.ok) {
		const error = new Error(data.message ?? `ошибка ${res.status}`) as TelegramError;
		error.code = res.status;
		// 403/404 — человек не нажимал «Начать» или заблокировал бота.
		error.fatal = res.status === 403 || res.status === 404;
		throw error;
	}
	return data;
}

type Button =
	| { type: 'open_app'; text: string; web_app: string; payload?: string }
	| { type: 'link'; text: string; url: string };

// payload кнопки доезжает до мини-приложения как start_param.
export function maxOpenMapButtons(from: 'notify' | 'welcome'): Button[][] {
	if (!botName) return [];
	return [[{ type: 'open_app', text: '🌌 Открыть карту', web_app: botName, payload: from }]];
}

export async function sendMaxMessage(
	maxUserId: bigint,
	text: string,
	buttons: Button[][] = [],
): Promise<void> {
	await call(
		'POST',
		'/messages',
		{ user_id: maxUserId.toString() },
		{
			text,
			format: 'html',
			attachments:
				buttons.length > 0 ? [{ type: 'inline_keyboard', payload: { buttons } }] : [],
		},
	);
}

// В событиях аватарки нет, она есть только у собеседника диалога.
export async function maxDialogAvatar(chatId: number): Promise<string | null> {
	const chat = (await call('GET', `/chats/${chatId}`)) as {
		dialog_with_user?: { full_avatar_url?: string; avatar_url?: string };
	};
	const user = chat.dialog_with_user;
	return user?.full_avatar_url ?? user?.avatar_url ?? null;
}

// Подписка при каждом старте: Макс снимает её сам после 8 ч без ответа.
async function subscribe(url: string): Promise<void> {
	const { subscriptions = [] } = (await call('GET', '/subscriptions')) as {
		subscriptions?: { url: string }[];
	};
	for (const sub of subscriptions) {
		if (sub.url !== url) await call('DELETE', '/subscriptions', { url: sub.url });
	}
	await call('POST', '/subscriptions', {}, {
		url,
		secret: maxWebhookSecret,
		update_types: ['bot_started'],
	});
}

export async function loadMaxBot(): Promise<void> {
	if (!maxEnabled) return;
	try {
		const me = (await call('GET', '/me')) as { username?: string };
		botName = me.username ?? null;
		// Подписка из локального запуска увела бы вебхук с боевого сервера.
		if (env.isProduction) await subscribe(`${env.publicBaseUrl}/max/webhook`);
		log.info(`Бот Макса: ${botName ?? 'без имени'}`);
	} catch (err) {
		log.error({ err }, 'бот Макса не поднялся, повтор через минуту');
		setTimeout(() => void loadMaxBot(), 60_000).unref();
	}
}
