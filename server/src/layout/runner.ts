import { db } from '../db.js';
import { env } from '../env.js';
import { log } from '../lib/log.js';
import { type Point } from '../../../shared/layout/index.js';
import { computeLayoutInThread } from './pool.js';
import { LAYOUT_PARAMS } from '../../../shared/layout/params.js';
import { lastGraphChangeAt, noteGraphChanged } from './state.js';

// Процесс pm2 ровно один, поэтому булева мьютекса в памяти достаточно.
let running = false;

export function isRecomputing(): boolean {
	return running;
}

export type RecomputeOptions = {
	full?: boolean;
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

		// «Узел уже был на небе» = createdAt ≤ computedAt, отдельный флаг не нужен.
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

		// Без прошлого коэффициента растяжения пересчёт начнёт с растянутого
		// неба и перетасует звёзды по дороге.
		const savedParams = (state?.params ?? null) as { scale?: number } | null;
		const previousScale =
			typeof savedParams?.scale === 'number' && savedParams.scale > 0
				? savedParams.scale
				: undefined;

		const result = await computeLayoutInThread({
			ids,
			edges,
			previous,
			anchors,
			full: options.full,
			long: options.iterations === 'long',
			previousScale,
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
					params: { ...LAYOUT_PARAMS, scale: result.scale },
				},
				update: {
					version: version + 1,
					dirty: false,
					computedAt: new Date(),
					params: { ...LAYOUT_PARAMS, scale: result.scale },
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
