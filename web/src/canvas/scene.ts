// Сцена: то, что рисуется на канвасе. Держит собственные копии узлов,
// потому что у картинки своя жизнь — переезды, вспышки, дрейф и мерцание
// происходят между запросами графа, а не в ответ на них.
import type { Graph, GraphNode, PendingInvite } from '../api/types';
import { haloColor, type RGB } from './palette';
import { randomFor } from './prng';

// Переезд при пересчёте раскладки — 1200 мс, никаких телепортаций (8.4).
const MOVE_MS = 1200;
// Появление новой звезды — вспышка за 900 мс.
const APPEAR_MS = 900;
// Линия к новой звезде прочерчивается за 400 мс.
export const DRAW_EDGE_MS = 400;
// Тусклая точка приглашения стоит на этом расстоянии от пригласившего.
const INVITE_RADIUS = 52;

export type Star = {
	id: string;
	node: GraphNode;

	// Куда узел едет и откуда. Между ними интерполяция easeInOutCubic.
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	moveStart: number;

	// Момент появления: null — звезда была здесь и раньше.
	appearAt: number | null;

	// Параметры дрейфа и мерцания, посеянные по id: при каждом заходе
	// звезда качается одинаково.
	amp: number;
	freqX: number;
	freqY: number;
	phaseX: number;
	phaseY: number;
	twinkleFreq: number;
	twinklePhase: number;

	radius: number;
	glow: number;
	bright: number;
	halo: RGB;

	// Глубина: −1 — дальний план, +1 — ближний. Берётся из id, поэтому
	// у каждого человека она своя и постоянная.
	depth: number;

	// Смещение от «домашнего» места и его скорость. Ими живёт только
	// перетаскивание на резинках: серверных координат это не касается,
	// после отпускания смещение само затухает в ноль.
	ox: number;
	oy: number;
	ovx: number;
	ovy: number;
};

export type InviteDot = {
	id: string;
	token: string;
	label: string | null;
	inviterId: string;
	x: number;
	y: number;
};

export type Scene = {
	stars: Map<string, Star>;
	order: Star[];
	edges: [Star, Star][];
	invites: InviteDot[];
	neighbours: Map<string, Set<string>>;
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
	layoutVersion: number;
	me: string;
};

export function emptyScene(): Scene {
	return {
		stars: new Map(),
		order: [],
		edges: [],
		invites: [],
		neighbours: new Map(),
		bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
		layoutVersion: -1,
		me: '',
	};
}

// Размер и яркость звезды (раздел 8.2), в мировых единицах.
function metrics(node: GraphNode): { radius: number; glow: number; bright: number } {
	const radius = Math.min(Math.max(1.8 + 2.2 * Math.sqrt(node.degree), 1.8), 14);
	return {
		radius,
		glow: radius * 4.5,
		bright: 0.55 + 0.45 * node.centrality,
	};
}

function makeStar(node: GraphNode, now: number, isNew: boolean): Star {
	const random = randomFor(node.id);
	const m = metrics(node);
	return {
		id: node.id,
		node,
		fromX: node.x,
		fromY: node.y,
		toX: node.x,
		toY: node.y,
		moveStart: now - MOVE_MS,
		appearAt: isNew ? now : null,
		// Хабы почти неподвижны, периферия плавает сильнее. Амплитуда меньше
		// расстояния между соседями, поэтому наложений дрейф не создаёт.
		amp: 6 / (1 + 0.35 * node.degree),
		// Периоды 8–20 секунд.
		freqX: (Math.PI * 2) / (8 + random() * 12),
		freqY: (Math.PI * 2) / (8 + random() * 12),
		phaseX: random() * Math.PI * 2,
		phaseY: random() * Math.PI * 2,
		// Мерцание: период 3–7 секунд.
		twinkleFreq: (Math.PI * 2) / (3 + random() * 4),
		twinklePhase: random() * Math.PI * 2,
		halo: haloColor(node.gender, node.isBlocked),
		// Хабы держим ближе к середине по глубине: у них и так самый большой
		// ореол, и на переднем плане они забивали бы всё вокруг.
		depth: (random() * 2 - 1) * (1 - 0.4 * node.centrality),
		ox: 0,
		oy: 0,
		ovx: 0,
		ovy: 0,
		...m,
	};
}

export function syncScene(scene: Scene, graph: Graph, now: number): Scene {
	const first = scene.layoutVersion === -1;
	const stars = new Map<string, Star>();

	for (const node of graph.nodes) {
		const existing = scene.stars.get(node.id);
		if (!existing) {
			// В первый заход всё небо уже существует — вспышками оно не осыпается.
			stars.set(node.id, makeStar(node, now, !first));
			continue;
		}

		existing.node = node;
		Object.assign(existing, metrics(node));
		existing.halo = haloColor(node.gender, node.isBlocked);

		// Сравниваем сами координаты, а не версию раскладки: предсказанные
		// клиентом места приходят с той же версией, что и прежние серверные.
		if (existing.toX !== node.x || existing.toY !== node.y) {
			// Едем из того места, где звезда находится прямо сейчас.
			const current = starPosition(existing, now);
			existing.fromX = current.x;
			existing.fromY = current.y;
			existing.toX = node.x;
			existing.toY = node.y;
			existing.moveStart = now;
		}
		stars.set(node.id, existing);
	}

	for (const star of stars.values()) {
		star.halo = haloColor(star.node.gender, star.node.isBlocked);
	}

	const edges: [Star, Star][] = [];
	const neighbours = new Map<string, Set<string>>();
	for (const [aId, bId] of graph.edges) {
		const a = stars.get(aId);
		const b = stars.get(bId);
		if (!a || !b) continue;
		edges.push([a, b]);
		if (!neighbours.has(aId)) neighbours.set(aId, new Set());
		if (!neighbours.has(bId)) neighbours.set(bId, new Set());
		neighbours.get(aId)!.add(bId);
		neighbours.get(bId)!.add(aId);
	}

	const invites = placeInvites(graph.pending, stars, graph.me);

	return {
		stars,
		// Порядок отрисовки: от дальних к ближним, а на одной глубине —
		// от тусклых к ярким, чтобы хабы не оказались под чужими ореолами.
		// Глубина у звезды постоянна, поэтому сортируем один раз здесь,
		// а не в каждом кадре.
		order: [...stars.values()].sort((a, b) => a.depth - b.depth || a.radius - b.radius),
		edges,
		invites,
		neighbours,
		bounds: computeBounds(stars, invites),
		layoutVersion: graph.layoutVersion,
		me: graph.me,
	};
}

// Приглашения в физике не участвуют: их позиция считается здесь, вокруг
// пригласившего, а угол берётся детерминированно из токена — чтобы точка
// не прыгала между заходами (раздел 7.8).
function placeInvites(
	pending: PendingInvite[],
	stars: Map<string, Star>,
	me: string,
): InviteDot[] {
	const inviter = stars.get(me);
	if (!inviter) return [];

	return pending.map((invite) => {
		const angle = randomFor(invite.token)() * Math.PI * 2;
		return {
			id: invite.id,
			token: invite.token,
			label: invite.label,
			inviterId: me,
			x: inviter.toX + INVITE_RADIUS * Math.cos(angle),
			y: inviter.toY + INVITE_RADIUS * Math.sin(angle),
		};
	});
}

function computeBounds(stars: Map<string, Star>, invites: InviteDot[]) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const star of stars.values()) {
		minX = Math.min(minX, star.toX);
		minY = Math.min(minY, star.toY);
		maxX = Math.max(maxX, star.toX);
		maxY = Math.max(maxY, star.toY);
	}
	for (const dot of invites) {
		minX = Math.min(minX, dot.x);
		minY = Math.min(minY, dot.y);
		maxX = Math.max(maxX, dot.x);
		maxY = Math.max(maxY, dot.y);
	}

	if (!Number.isFinite(minX)) return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
	// Небо из одного человека тоже должно иметь размер.
	if (maxX - minX < 200) {
		const cx = (minX + maxX) / 2;
		minX = cx - 100;
		maxX = cx + 100;
	}
	if (maxY - minY < 200) {
		const cy = (minY + maxY) / 2;
		minY = cy - 100;
		maxY = cy + 100;
	}
	return { minX, minY, maxX, maxY };
}

// Положение звезды без дрейфа: результат интерполяции переезда.
export function starPosition(star: Star, now: number): { x: number; y: number } {
	const t = Math.min(1, (now - star.moveStart) / MOVE_MS);
	if (t >= 1) return { x: star.toX, y: star.toY };
	const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
	return {
		x: star.fromX + (star.toX - star.fromX) * k,
		y: star.fromY + (star.toY - star.fromY) * k,
	};
}

export const APPEAR_DURATION = APPEAR_MS;
