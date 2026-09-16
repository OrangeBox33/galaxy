// Отправка идёт ТОЛЬКО через BotOutbox: прямой sendMessage упал бы
// на заблокировавшем бота и уронил вместе с собой полезное действие.
import type { Prisma } from '@prisma/client';
import { db } from '../db.js';

type Db = Prisma.TransactionClient | typeof db;

export type OutboxKind = 'invite_accepted' | 'linked';

export async function enqueue(
	client: Db,
	userId: bigint,
	kind: OutboxKind,
	text: string,
): Promise<void> {
	await client.botOutbox.create({ data: { userId, kind, text } });
}

// Имя пользователя подставляется в HTML-сообщение, поэтому экранируется.
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
