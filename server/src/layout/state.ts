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

// Во сколько раз готовая раскладка растянута против размера, к которому сходится
// симуляция. Клиенту нужен для предсказания: без него оно стартует с растянутого
// неба, силы принимаются его сжимать и перетасовывают звёзды на пол-экрана.
export async function getLayoutScale(client: Db = db): Promise<number> {
	const state = await client.layoutState.findUnique({ where: { id: 1 } });
	const params = (state?.params ?? null) as { scale?: number } | null;
	return typeof params?.scale === 'number' && params.scale > 0 ? params.scale : 1;
}
