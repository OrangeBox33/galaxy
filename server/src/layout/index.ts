// Раскладка целиком, чистой функцией: на вход граф и предыдущие координаты,
// на выход новые. Ничего не знает про БД — поэтому её можно гонять в тестах
// (раздел 13) сотнями прогонов.
import { computeCentrality } from './centrality.js';
import { centerByMass, scaleToPercentile } from './normalize.js';
import { LAYOUT_PARAMS as P } from './params.js';
import { applyTransform, bestTransform, type Pair } from './procrustes.js';
import { makeNode, simulate, sunflowerPosition, type SimNode } from './simulate.js';
import { prngForId } from '../lib/prng.js';

export type Point = { x: number; y: number };

export type LayoutInput = {
	// Узлы в стабильном порядке (обычно по id): от него зависит воспроизводимость.
	ids: bigint[];
	// Рёбра как пары индексов в ids.
	edges: [number, number][];
	// Координаты с прошлого пересчёта. Узлов, которых там нет, ещё не было на небе.
	previous?: Map<bigint, Point>;
	// Кто «привёл» нового узла: рядом с ним звезда и загорится.
	anchors?: Map<bigint, bigint>;
	// Полный пересчёт начинает с подсолнуха, инкрементальный — с сохранённых мест.
	full?: boolean;
	// Тёплый пересчёт: старт с сохранённых мест, но с бюджетом полного.
	long?: boolean;
};

export type LayoutResult = {
	nodes: { id: bigint; x: number; y: number; degree: number; centrality: number }[];
	iterations: number;
};

export function computeLayout(input: LayoutInput): LayoutResult {
	const previous = input.previous ?? new Map<bigint, Point>();
	const anchors = input.anchors ?? new Map<bigint, bigint>();
	const full = input.full ?? false;

	const centrality = computeCentrality({ ids: input.ids, edges: input.edges });
	const nodes: SimNode[] = input.ids.map((id, i) =>
		makeNode(id, centrality.degree[i], centrality.value[i]),
	);

	// Список смежности нужен и для поиска якоря новому узлу.
	const neighbours: number[][] = input.ids.map(() => []);
	for (const [a, b] of input.edges) {
		neighbours[a].push(b);
		neighbours[b].push(a);
	}

	placeInitial(nodes, neighbours, previous, anchors, full);

	const long = full || (input.long ?? false);
	const iterations = long ? P.FULL_ITERATIONS : P.INCREMENTAL_ITERATIONS;
	simulate(nodes, input.edges, {
		alpha: full ? P.FULL_ALPHA : P.INCREMENTAL_ALPHA,
		iterations,
	});

	centerByMass(nodes);
	scaleToPercentile(nodes);
	alignToPrevious(nodes, previous);

	return {
		nodes: nodes.map((node) => ({
			id: node.id,
			x: node.x,
			y: node.y,
			degree: node.degree,
			centrality: node.centrality,
		})),
		iterations,
	};
}

// Начальные позиции (раздел 7.5–7.6).
function placeInitial(
	nodes: SimNode[],
	neighbours: number[][],
	previous: Map<bigint, Point>,
	anchors: Map<bigint, bigint>,
	full: boolean,
): void {
	// Порядок для подсолнуха: по убыванию ĉ, чтобы хабы сразу оказались в центре.
	// При равной центральности порядок решает id — иначе раскладка перестанет
	// быть воспроизводимой.
	const ranked = nodes
		.map((node, index) => ({ node, index }))
		.sort((a, b) =>
			b.node.centrality - a.node.centrality || (a.node.id < b.node.id ? -1 : 1),
		);
	const rank = new Map<bigint, number>();
	ranked.forEach((entry, position) => rank.set(entry.node.id, position));

	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const saved = previous.get(node.id);
		if (saved && !full) {
			node.x = saved.x;
			node.y = saved.y;
			continue;
		}

		if (!full) {
			// Новый узел ставится рядом с тем, кто его привёл: так вспышка новой
			// звезды видна там, где её ждут.
			const anchorId = anchors.get(node.id);
			const anchorPoint =
				(anchorId !== undefined ? previous.get(anchorId) : undefined) ??
				firstKnownNeighbour(nodes, neighbours[index], previous);
			if (anchorPoint) {
				const angle = prngForId(node.id)() * Math.PI * 2;
				node.x = anchorPoint.x + P.NEW_NODE_OFFSET * Math.cos(angle);
				node.y = anchorPoint.y + P.NEW_NODE_OFFSET * Math.sin(angle);
				continue;
			}
		}

		const position = sunflowerPosition(rank.get(node.id) ?? 0, nodes.length);
		node.x = position.x;
		node.y = position.y;
	}
}

// Если пригласившего нет (связь создана кнопкой или админом), якорем служит
// первый уже размещённый сосед. Порядок обхода — по id, чтобы выбор не зависел
// от порядка рёбер в базе.
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
