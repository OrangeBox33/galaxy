// Таймер пересчитывает раскладку через LAYOUT_RECOMPUTE_DEBOUNCE_MS
// тишины: иначе десяток связей, созданных подряд в админке, дал бы десяток пересчётов.
import type { Prisma } from '@prisma/client';
import { db } from '../db.js';

type Db = Prisma.TransactionClient | typeof db;

let lastChangeAt = 0;

export function noteGraphChanged(): void {
	lastChangeAt = Date.now();
}

export function lastGraphChangeAt(): number {
	return lastChangeAt;
}

export async function markLayoutDirty(client: Db = db): Promise<void> {
	noteGraphChanged();
	await client.layoutState.upsert({
		where: { id: 1 },
		create: { id: 1, dirty: true, params: {} },
		update: { dirty: true },
	});
}

export async function getLayoutVersion(client: Db = db): Promise<number> {
	const state = await client.layoutState.findUnique({ where: { id: 1 } });
	return state?.version ?? 0;
}
