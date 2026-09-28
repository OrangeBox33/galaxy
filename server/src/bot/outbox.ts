// Отправка идёт ТОЛЬКО через BotOutbox: прямой sendMessage упал бы
// на заблокировавшем бота и уронил вместе с собой полезное действие.
import type { Prisma } from '@prisma/client';
import { db } from '../db.js';

type Db = Prisma.TransactionClient | typeof db;

export type OutboxKind = 'by_link' | 'linked';

export async function enqueue(
	client: Db,
	userId: bigint,
	kind: OutboxKind,
	actorId: bigint,
): Promise<void> {
	await client.botOutbox.create({ data: { userId, kind, actorId } });
}

export type OutboxEvent = { kind: string; name: string };

const NAMES_PER_LINE = 5;

export function composeMessage(events: OutboxEvent[]): string {
	if (events.length === 1) {
		const [{ kind, name }] = events;
		return kind === 'by_link'
			? `🌟 <b>${escapeHtml(name)}</b> пришёл(ла) по твоей ссылке — ` +
					'рядом с твоей звездой загорелась новая.'
			: `✨ <b>${escapeHtml(name)}</b> отметил(а) знакомство с тобой на карте.`;
	}

	const names = (kind: string) => events.filter((e) => e.kind === kind).map((e) => e.name);
	const byLink = names('by_link');
	const linked = names('linked');

	const lines = ['🌌 Пока тебя не было, на небе прибавилось:', ''];
	if (byLink.length === 1) lines.push(`🌟 По твоей ссылке пришёл(ла) ${nameList(byLink)}`);
	if (byLink.length > 1) lines.push(`🌟 По твоей ссылке пришли: ${nameList(byLink)}`);
	if (linked.length === 1) lines.push(`✨ Отметил(а) знакомство с тобой ${nameList(linked)}`);
	if (linked.length > 1) lines.push(`✨ Отметили знакомство с тобой: ${nameList(linked)}`);
	return lines.join('\n');
}

// Имён не больше пяти на строку: у сообщения предел 4096 знаков.
function nameList(names: string[]): string {
	const shown = names.slice(0, NAMES_PER_LINE).map((name) => `<b>${escapeHtml(name)}</b>`);
	const rest = names.length - shown.length;
	return rest > 0 ? `${shown.join(', ')} и ещё ${rest}` : shown.join(', ');
}

// Имя пользователя подставляется в HTML-сообщение, поэтому экранируется.
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
