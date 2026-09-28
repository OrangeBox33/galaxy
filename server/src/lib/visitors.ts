// Кто стоит за IP, известно только по недавним запросам с сессией: nginx пишет
// в журнал один адрес. За общим адресом оператора бывают и посторонние, поэтому
// это «заходили с этого адреса», а не «это он».
import { db } from '../db.js';
import { displayName } from './names.js';

const TTL_MS = 60 * 60_000;

const seen = new Map<string, Map<bigint, number>>();

setInterval(() => {
	const cutoff = Date.now() - TTL_MS;
	for (const [ip, users] of seen) {
		for (const [id, at] of users) if (at < cutoff) users.delete(id);
		if (users.size === 0) seen.delete(ip);
	}
}, 10 * 60_000).unref();

export function rememberVisitor(ip: string | undefined, userId: bigint): void {
	if (!ip) return;
	let users = seen.get(ip);
	if (!users) {
		users = new Map();
		seen.set(ip, users);
	}
	users.set(userId, Date.now());
}

export function visitorsOf(ip: string): bigint[] {
	const cutoff = Date.now() - TTL_MS;
	return [...(seen.get(ip) ?? [])].filter(([, at]) => at >= cutoff).map(([id]) => id);
}

export async function describeUsers(ids: bigint[]): Promise<Map<bigint, string>> {
	if (ids.length === 0) return new Map();
	const users = await db.user.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			customName: true,
			telegramFirstName: true,
			telegramLastName: true,
			telegramUsername: true,
		},
	});
	return new Map(
		users.map((user) => [
			user.id,
			`${displayName(user)}${user.telegramUsername ? ` @${user.telegramUsername}` : ''} (${user.id})`,
		]),
	);
}

export function visitorsLine(ids: bigint[], names: Map<bigint, string>): string {
	if (ids.length === 0) return 'С этого адреса за час никто не входил';
	return `С этого адреса за час: ${ids.map((id) => names.get(id) ?? id.toString()).join(', ')}`;
}
