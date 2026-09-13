// Пересчёт раскладки на данных из БД и таймер, который его запускает
// (раздел 7.6–7.8).
import { db } from '../db.js';
import { env } from '../env.js';
import { log } from '../lib/log.js';
import { computeLayout, type Point } from './index.js';
import { LAYOUT_PARAMS } from './params.js';
import { lastGraphChangeAt, noteGraphChanged } from './state.js';

// Пересчёты не должны накладываться. Процесс pm2 ровно один, поэтому
// простого булева мьютекса в памяти достаточно.
let running = false;

export function isRecomputing(): boolean {
	return running;
}

export type RecomputeOptions = {
	// full — начать с подсолнуха, как при первом запуске.
	full?: boolean;
	// 'long' — тёплый пересчёт: стартуем с сохранённых мест, но даём столько же
	// времени, сколько полному. Небо перекладывается мягко, без телепортаций.
	iterations?: 'long';
};

export async function recomputeLayout(options: RecomputeOptions = {}): Promise<{
	version: number;
	nodes: number;
	ms: number;
}> {
	if (running) throw new Error('пересчёт уже идёт');
	running = true;
	const startedAt = Date.now();

	try {
		const [users, links, state] = await Promise.all([
			db.user.findMany({
				select: { id: true, x: true, y: true, createdAt: true },
				orderBy: { id: 'asc' },
			}),
			db.link.findMany({ select: { aId: true, bId: true } }),
			db.layoutState.findUnique({ where: { id: 1 } }),
		]);

		const ids = users.map((user) => user.id);
		const indexById = new Map(ids.map((id, index) => [id, index]));

		const edges: [number, number][] = [];
		for (const link of links) {
			const a = indexById.get(link.aId);
			const b = indexById.get(link.bId);
			if (a === undefined || b === undefined) continue;
			edges.push([a, b]);
		}

		// «Узел уже был на небе» = он существовал на момент прошлого пересчёта.
		// Отдельного флага для этого не нужно: хватает createdAt и computedAt.
		const previous = new Map<bigint, Point>();
		const version = state?.version ?? 0;
		const computedAt = state?.computedAt ?? null;
		if (version > 0 && computedAt) {
			for (const user of users) {
				if (user.createdAt <= computedAt) previous.set(user.id, { x: user.x, y: user.y });
			}
		}

		// Новый узел ставится рядом с пригласившим.
		const anchors = new Map<bigint, bigint>();
		const newIds = ids.filter((id) => !previous.has(id));
		if (newIds.length > 0) {
			const invites = await db.invite.findMany({
				where: { acceptedById: { in: newIds }, status: 'ACCEPTED' },
				select: { acceptedById: true, inviterId: true },
			});
			for (const invite of invites) {
				if (invite.acceptedById) anchors.set(invite.acceptedById, invite.inviterId);
			}
		}

		const result = computeLayout({
			ids,
			edges,
			previous,
			anchors,
			full: options.full,
			long: options.iterations === 'long',
		});

		await db.$transaction([
			...result.nodes.map((node) =>
				db.user.update({
					where: { id: node.id },
					data: {
						x: node.x,
						y: node.y,
						degree: node.degree,
						centrality: node.centrality,
					},
				}),
			),
			db.layoutState.upsert({
				where: { id: 1 },
				create: {
					id: 1,
					version: version + 1,
					dirty: false,
					computedAt: new Date(),
					params: LAYOUT_PARAMS,
				},
				update: {
					version: version + 1,
					dirty: false,
					computedAt: new Date(),
					params: LAYOUT_PARAMS,
				},
			}),
		]);

		const ms = Date.now() - startedAt;
		log.info(
			{ version: version + 1, nodes: ids.length, edges: edges.length, ms, full: !!options.full },
			'раскладка пересчитана',
		);
		return { version: version + 1, nodes: ids.length, ms };
	} finally {
		running = false;
	}
}

// Таймер раз в секунду смотрит на флаг и ждёт тишины в LAYOUT_RECOMPUTE_DEBOUNCE_MS
// после последнего изменения.
export function startLayoutScheduler(): void {
	const timer = setInterval(() => {
		void tick();
	}, 1000);
	timer.unref();

	// Если процесс перезапустили с непересчитанной раскладкой — досчитаем.
	void db.layoutState
		.findUnique({ where: { id: 1 } })
		.then((state) => {
			if (state?.dirty) noteGraphChanged();
		})
		.catch((err) => log.error({ err }, 'не удалось прочитать состояние раскладки'));
}

async function tick(): Promise<void> {
	if (running) return;
	try {
		const state = await db.layoutState.findUnique({ where: { id: 1 } });
		if (!state?.dirty) return;
		if (Date.now() - lastGraphChangeAt() < env.layoutDebounceMs) return;
		await recomputeLayout({ full: false });
	} catch (err) {
		log.error({ err }, 'пересчёт раскладки не удался');
	}
}
