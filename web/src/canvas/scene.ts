import type { Graph, GraphNode, PendingInvite } from '../api/types';
import { haloColor, type RGB } from './palette';
import { randomFor } from './prng';
// Радиус — из общего кода: им же раскладка разводит звёзды, чтобы не налезали друг на друга.
import { starRadius } from '../../../shared/layout/params';

const MOVE_MS = 1200;
const APPEAR_MS = 900;
export const DRAW_EDGE_MS = 400;
const INVITE_RADIUS = 52;

export type Star = {
	id: string;
	node: GraphNode;

	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	moveStart: number;

	appearAt: number | null;

	amp: number;
	freqX: number;
	freqY: number;
	phaseX: number;
	phaseY: number;
	twinklePhase: number;

	radius: number;
	flame: number;
	halo: RGB;

	depth: number;

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
	byRadius: Star[];
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
		byRadius: [],
		edges: [],
		invites: [],
		neighbours: new Map(),
		bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
		layoutVersion: -1,
		me: '',
	};
}

function makeStar(node: GraphNode, now: number, isNew: boolean): Star {
	const random = randomFor(node.id);
	return {
		id: node.id,
		node,
		fromX: node.x,
		fromY: node.y,
		toX: node.x,
		toY: node.y,
		moveStart: now - MOVE_MS,
		appearAt: isNew ? now : null,
		amp: 6 / (1 + 0.35 * node.degree),
		freqX: (Math.PI * 2) / (8 + random() * 12),
		freqY: (Math.PI * 2) / (8 + random() * 12),
		phaseX: random() * Math.PI * 2,
		phaseY: random() * Math.PI * 2,
		twinklePhase: random() * Math.PI * 2,
		halo: haloColor(node.gender, node.isBlocked),
		depth: (random() * 2 - 1) * (1 - 0.4 * node.centrality),
		ox: 0,
		oy: 0,
		ovx: 0,
		ovy: 0,
		radius: starRadius(node.degree),
		flame: node.flame,
	};
}

export function syncScene(scene: Scene, graph: Graph, now: number): Scene {
	const first = scene.layoutVersion === -1;
	const stars = new Map<string, Star>();

	for (const node of graph.nodes) {
		const existing = scene.stars.get(node.id);
		if (!existing) {
			stars.set(node.id, makeStar(node, now, !first));
			continue;
		}

		existing.node = node;
		existing.radius = starRadius(node.degree);
		existing.flame = node.flame;
		existing.halo = haloColor(node.gender, node.isBlocked);

		// Сравниваем координаты, а не версию: предсказанные места приходят с прежней версией.
		if (existing.toX !== node.x || existing.toY !== node.y) {
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
		// Чтобы хабы не оказались под чужими ореолами.
		order: [...stars.values()].sort((a, b) => a.depth - b.depth || a.radius - b.radius),
		byRadius: [...stars.values()].sort((a, b) => b.radius - a.radius),
		edges,
		invites,
		neighbours,
		bounds: computeBounds(stars, invites),
		layoutVersion: graph.layoutVersion,
		me: graph.me,
	};
}

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
