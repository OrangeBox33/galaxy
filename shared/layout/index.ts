// Один и тот же расчёт идёт на сервере и в браузере, но до бита они
// не совпадут: стандарт JavaScript не фиксирует точность sin и cos. Истина
// серверная, клиентская раскладка — лишь предсказание.
import { computeCentrality } from './centrality.js';
import { findClusters } from './clusters.js';
import { centerByMass, percentileScale } from './normalize.js';
import { resolveParams, starRadius, type LayoutOverrides, type LayoutParams } from './params.js';
import { applyTransform, bestTransform, type Pair } from './procrustes.js';
import {
	buildNeighbours,
	makeNode,
	simulate,
	sunflowerPosition,
	type SimNode,
} from './simulate.js';
import { prngForId } from '../prng.js';

export type Point = { x: number; y: number };

// Столько проб хватает, чтобы спираль ушла за край неба; стоит это сотню-другую
// сравнений, и только при появлении новичка.
const FREE_SPOT_TRIES = 400;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Шаг спирали, которой ищется место новой звезде, и зазор до соседей.
const NEW_NODE_STEP = 26;
const NEW_NODE_GAP = 6;
const CLUSTER_ITERATIONS = 24;

export type LayoutInput = {
	// Стабильный порядок (обычно по id): от него зависит воспроизводимость.
	ids: bigint[];
	edges: [number, number][];
	previous?: Map<bigint, Point>;
	anchors?: Map<bigint, bigint>;
	full?: boolean;
	long?: boolean;
	maxIterations?: number;
	// Во сколько раз прошлый пересчёт растянул небо: нужен, чтобы начать
	// с того же масштаба, в котором живёт симуляция, — см. `scale`.
	previousScale?: number;
	// Только для песочницы: на бою переопределений нет.
	params?: LayoutOverrides;
};

export type LayoutResult = {
	nodes: {
		id: bigint;
		x: number;
		y: number;
		degree: number;
		centrality: number;
		// Раскладке сообщества нужны для сил, наружу отдаются ради песочницы:
		// там небо красится по компаниям.
		cluster: number;
		component: number;
	}[];
	iterations: number;
	// Во сколько раз готовая раскладка растянута против размера, к которому
	// сошлась симуляция (силы заданы в абсолютных единицах, нормализация тянет
	// небо к R_MAX). Обязан пережить пересчёт и вернуться в previousScale: иначе
	// силы примутся сжимать растянутое небо и по дороге перетасуют звёзды —
	// пересчёт без изменений в графе двигал медианную звезду на 340 из 1400.
	scale: number;
};

export function computeLayout(input: LayoutInput): LayoutResult {
	const P = resolveParams(input.params);
	const previous = input.previous ?? new Map<bigint, Point>();
	const anchors = input.anchors ?? new Map<bigint, bigint>();
	const full = input.full ?? false;

	const centrality = computeCentrality({ ids: input.ids, edges: input.edges });
	const nodes: SimNode[] = input.ids.map((id, i) =>
		makeNode(id, centrality.degree[i], centrality.value[i]),
	);

	const neighbours = buildNeighbours(input.ids.length, input.edges);
	const clusters = findClusters(neighbours, CLUSTER_ITERATIONS);

	// Небо на входе растянуто нормализацией: сжимаем его к масштабу симуляции,
	// иначе первые же итерации уйдут на переезд.
	const previousScale = input.previousScale ?? 1;
	const start =
		full || previousScale === 1
			? previous
			: new Map(
					[...previous].map(([id, point]) => [
						id,
						{ x: point.x / previousScale, y: point.y / previousScale },
					]),
				);

	placeInitial(nodes, neighbours, start, anchors, full, P, previousScale);

	const long = full || (input.long ?? false);
	const iterations = Math.min(
		input.maxIterations ?? Infinity,
		long ? P.FULL_ITERATIONS : P.INCREMENTAL_ITERATIONS,
	);
	simulate(nodes, input.edges, {
		alpha: full ? P.FULL_ALPHA : P.INCREMENTAL_ALPHA,
		iterations,
		params: input.params,
		neighbours,
		clusters,
	});

	centerByMass(nodes);
	const scale = percentileScale(nodes, P);
	for (const node of nodes) {
		node.x *= scale;
		node.y *= scale;
	}
	alignToPrevious(nodes, previous);

	return {
		nodes: nodes.map((node, i) => ({
			id: node.id,
			x: node.x,
			y: node.y,
			degree: node.degree,
			centrality: node.centrality,
			cluster: clusters.cluster[i],
			component: clusters.component[i],
		})),
		iterations,
		scale,
	};
}

function placeInitial(
	nodes: SimNode[],
	neighbours: number[][],
	previous: Map<bigint, Point>,
	anchors: Map<bigint, bigint>,
	full: boolean,
	params: LayoutParams,
	previousScale: number,
): void {
	// При равной центральности порядок решает id: иначе раскладка перестаёт
	// быть воспроизводимой.
	const ranked = nodes
		.map((node, index) => ({ node, index }))
		.sort((a, b) =>
			b.node.centrality - a.node.centrality || (a.node.id < b.node.id ? -1 : 1),
		);
	const rank = new Map<bigint, number>();
	ranked.forEach((entry, position) => rank.set(entry.node.id, position));

	// Каждая только что поставленная звезда тоже попадает сюда, иначе двое
	// новичков сели бы друг на друга.
	const taken: { x: number; y: number; radius: number }[] = [];
	for (const node of nodes) {
		const saved = previous.get(node.id);
		if (saved && !full) taken.push({ x: saved.x, y: saved.y, radius: node.radius });
	}

	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const saved = previous.get(node.id);
		if (saved && !full) {
			node.x = saved.x;
			node.y = saved.y;
			continue;
		}

		if (!full) {
			const anchorId = anchors.get(node.id);
			const anchorPoint =
				(anchorId !== undefined ? previous.get(anchorId) : undefined) ??
				firstKnownNeighbour(nodes, neighbours[index], previous);
			const spot = freeSpot(node, anchorPoint, taken, params, previousScale);
			node.x = spot.x;
			node.y = spot.y;
			taken.push({ x: node.x, y: node.y, radius: node.radius });
			continue;
		}

		const position = sunflowerPosition(rank.get(node.id) ?? 0, nodes.length, params);
		node.x = position.x;
		node.y = position.y;
	}
}

// Куда поставить звезду, которой на небе ещё не было: вплотную к чужой звезде
// новичок появляться не должен. Спираль, а не радиус: у пришедшего по ссылке
// она раскручивается от пригласившего (рядом, но не вплотную), у пришедшего
// самого — по всей площади неба, а не по какой-то орбите.
function freeSpot(
	node: SimNode,
	anchor: Point | undefined,
	taken: { x: number; y: number; radius: number }[],
	params: LayoutParams,
	previousScale: number,
): Point {
	// Начальные позиции живут в масштабе симуляции, а радиусы звёзд —
	// в экранном: приводим зазор к одним единицам.
	const shrink = previousScale > 0 ? 1 / previousScale : 1;
	const clear = (other: { radius: number }): number =>
		(node.radius + other.radius + NEW_NODE_GAP) * shrink;

	const random = prngForId(node.id);
	const turn = random() * Math.PI * 2;
	const step = NEW_NODE_STEP * shrink;
	const centre = anchor ?? { x: 0, y: 0 };
	// Безродному незачем жаться к середине: спираль начинается с любого места
	// неба, своего для каждого человека.
	const from = anchor ? step : random() * params.R_MAX * shrink;
	const limit = params.R_MAX * shrink * 1.4;

	let best: Point | null = null;
	let bestGap = -Infinity;
	for (let i = 0; i < FREE_SPOT_TRIES; i += 1) {
		// Золотой угол плюс радиус как корень: точки ложатся по площади ровно,
		// без сгущения.
		const angle = turn + i * GOLDEN_ANGLE;
		const radius = from + step * Math.sqrt(i);
		if (radius > limit && best) break;
		const point = { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };

		let gap = Infinity;
		for (const other of taken) {
			gap = Math.min(gap, Math.hypot(point.x - other.x, point.y - other.y) - clear(other));
			if (gap < bestGap) break;
		}
		if (gap >= 0) return point;
		if (gap > bestGap) {
			bestGap = gap;
			best = point;
		}
	}
	return best ?? { x: centre.x + step, y: centre.y };
}

// Куда сядет звезда, которой на небе ещё не было, — сразу в координатах готовой
// раскладки. Нужна серверу: место выдаётся при первом входе, до ближайшего
// пересчёта, иначе новичок висел бы в нуле — в самой гуще неба. Масштаб здесь
// единичный: радиусы звёзд и R_MAX заданы в тех же растянутых единицах, в
// которых лежат координаты в базе.
export function placeNewStar(input: {
	id: bigint;
	degree: number;
	anchor?: Point;
	taken: { x: number; y: number; degree: number }[];
	params?: LayoutOverrides;
}): Point {
	const P = resolveParams(input.params);
	const node = makeNode(input.id, input.degree, 0);
	const taken = input.taken.map((star) => ({
		x: star.x,
		y: star.y,
		radius: starRadius(star.degree),
	}));
	return freeSpot(node, input.anchor, taken, P, 1);
}

// Порядок обхода — по id, чтобы выбор не зависел от порядка рёбер в базе.
function firstKnownNeighbour(
	nodes: SimNode[],
	indices: number[],
	previous: Map<bigint, Point>,
): Point | undefined {
	const known = indices
		.map((index) => nodes[index])
		.filter((neighbour) => previous.has(neighbour.id))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
	return known.length > 0 ? previous.get(known[0].id) : undefined;
}

function alignToPrevious(nodes: SimNode[], previous: Map<bigint, Point>): void {
	const pairs: Pair[] = [];
	for (const node of nodes) {
		const old = previous.get(node.id);
		if (!old) continue;
		pairs.push({ px: node.x, py: node.y, qx: old.x, qy: old.y, w: node.mass });
	}
	const transform = bestTransform(pairs);
	if (transform) applyTransform(nodes, transform);
}
