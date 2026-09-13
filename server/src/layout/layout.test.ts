// Тесты раскладки — самая важная часть проверки (раздел 13 ТЗ).
// Раскладка детерминирована, поэтому все проверки точные, без «примерно похоже».
import { describe, expect, it } from 'vitest';
import { computeLayout, type Point } from './index.js';
import { LAYOUT_PARAMS as P, starRadius } from './params.js';
import { makeNode, simulate, sunflowerPosition } from './simulate.js';
import { computeCentrality } from './centrality.js';
import { applyTransform, bestTransform, type Pair } from './procrustes.js';
import { mulberry32 } from '../lib/prng.js';

const R = P.R_MAX;

type Graph = { ids: bigint[]; edges: [number, number][] };

// Граф-звезда: один хаб и заданное число листьев.
function star(hubIndex: number, leaves: number, offset: number): [number, number][] {
	const edges: [number, number][] = [];
	for (let i = 0; i < leaves; i += 1) edges.push([hubIndex, offset + i]);
	return edges;
}

function ids(n: number): bigint[] {
	return Array.from({ length: n }, (_, i) => BigInt(i + 1));
}

function distance(point: Point): number {
	return Math.hypot(point.x, point.y);
}

describe('раскладка', () => {
	it('одна звезда: хаб садится в центр', () => {
		// 1 хаб + 12 листьев. Отталкивание от периферии гасится по симметрии,
		// и хабу остаётся только центр.
		const graph: Graph = { ids: ids(13), edges: star(0, 12, 1) };
		const result = computeLayout({ ...graph, full: true });

		const hub = result.nodes[0];
		expect(distance(hub)).toBeLessThan(0.08 * R);
	});

	it('двойная звезда: хабы расходятся симметрично вокруг общего центра', () => {
		// Два хаба по 12 листьев, между собой не связаны.
		const total = 26;
		const graph: Graph = {
			ids: ids(total),
			edges: [...star(0, 12, 2), ...star(1, 12, 14)],
		};

		// Центр масс проверяем ДО нормализации: иначе проверка бессмысленна —
		// шаг 7.7.1 сдвигает центроид в (0,0) арифметически, независимо от того,
		// работает физика или нет. Здесь же видно, что систему держит в центре
		// сама радиальная привязка.
		const centrality = computeCentrality(graph);
		const nodes = graph.ids.map((id, i) =>
			makeNode(id, centrality.degree[i], centrality.value[i]),
		);
		const ranked = nodes
			.map((node, index) => ({ node, index }))
			.sort((a, b) => b.node.centrality - a.node.centrality || a.index - b.index);
		ranked.forEach((entry, position) => {
			const start = sunflowerPosition(position, nodes.length);
			entry.node.x = start.x;
			entry.node.y = start.y;
		});
		simulate(nodes, graph.edges, { alpha: P.FULL_ALPHA, iterations: P.FULL_ITERATIONS });

		let sumX = 0;
		let sumY = 0;
		let sumMass = 0;
		for (const node of nodes) {
			sumX += node.x * node.mass;
			sumY += node.y * node.mass;
			sumMass += node.mass;
		}
		const centroid = Math.hypot(sumX / sumMass, sumY / sumMass);
		expect(centroid).toBeLessThan(0.05 * R);

		// А после нормализации проверяем саму картину двойной звезды.
		const result = computeLayout({ ...graph, full: true });
		const first = result.nodes[0];
		const second = result.nodes[1];
		const d1 = distance(first);
		const d2 = distance(second);

		// Хабы действительно разошлись, а не слиплись в центре.
		expect(Math.min(d1, d2)).toBeGreaterThan(0.05 * R);
		// Расстояния до центра различаются не больше чем на 15%.
		expect(Math.abs(d1 - d2) / Math.max(d1, d2)).toBeLessThan(0.15);
		// И они по разные стороны от центра: середина между ними — центр карты.
		const cos = (first.x * second.x + first.y * second.y) / (d1 * d2);
		expect(cos).toBeLessThan(-0.85);
	});

	it('монотонность: чем больше степень, тем ближе к центру', () => {
		const random = mulberry32(12345);
		const n = 60;
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		// Предпочтительное присоединение: узлы с меньшим индексом получают
		// больше связей — так в графе появляются и хабы, и одиночки.
		for (let i = 1; i < n; i += 1) {
			const links = 1 + Math.floor(random() * 3);
			for (let k = 0; k < links; k += 1) {
				const j = Math.floor(random() ** 2 * i);
				const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
				if (i === j || seen.has(key)) continue;
				seen.add(key);
				edges.push([Math.min(i, j), Math.max(i, j)]);
			}
		}

		const result = computeLayout({ ids: ids(n), edges, full: true });
		const degrees = result.nodes.map((node) => node.degree);
		const distances = result.nodes.map((node) => distance(node));

		expect(spearman(degrees, distances)).toBeLessThanOrEqual(-0.6);
	});

	it('детерминизм: два прогона дают одинаковые координаты', () => {
		const graph: Graph = { ids: ids(40), edges: star(0, 12, 1).concat(star(13, 10, 20)) };
		const first = computeLayout({ ...graph, full: true });
		const second = computeLayout({ ...graph, full: true });

		for (let i = 0; i < first.nodes.length; i += 1) {
			expect(Math.abs(first.nodes[i].x - second.nodes[i].x)).toBeLessThan(1e-9);
			expect(Math.abs(first.nodes[i].y - second.nodes[i].y)).toBeLessThan(1e-9);
		}
	});

	it('стабильность: новый узел не перетасовывает небо', () => {
		const n = 100;
		const random = mulberry32(777);
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		for (let i = 1; i < n; i += 1) {
			const j = Math.floor(random() ** 2 * i);
			const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
			if (i !== j && !seen.has(key)) {
				seen.add(key);
				edges.push([Math.min(i, j), Math.max(i, j)]);
			}
		}

		const base = computeLayout({ ids: ids(n), edges, full: true });
		const previous = new Map<bigint, Point>(
			base.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
		);

		// Добавляем 101-го, связанного с узлом 1.
		const grownIds = [...ids(n), BigInt(n + 1)];
		const grownEdges: [number, number][] = [...edges, [0, n]];
		const grown = computeLayout({
			ids: grownIds,
			edges: grownEdges,
			previous,
			anchors: new Map([[BigInt(n + 1), 1n]]),
		});

		const shifts = grown.nodes
			.filter((node) => previous.has(node.id))
			.map((node) => {
				const old = previous.get(node.id)!;
				return Math.hypot(node.x - old.x, node.y - old.y);
			})
			.sort((a, b) => a - b);

		const median = shifts[Math.floor(shifts.length / 2)];
		expect(median).toBeLessThan(0.03 * R);
	});

	it('прокруст: повёрнутая и отражённая раскладка возвращается на место', () => {
		const graph: Graph = { ids: ids(30), edges: star(0, 12, 1).concat(star(13, 8, 20)) };
		const original = computeLayout({ ...graph, full: true });

		// Поворот на 90° и отражение по оси Y.
		const theta = Math.PI / 2;
		const distorted = original.nodes.map((node) => {
			const x = -node.x;
			const y = node.y;
			return {
				id: node.id,
				x: Math.cos(theta) * x - Math.sin(theta) * y,
				y: Math.sin(theta) * x + Math.cos(theta) * y,
			};
		});

		const pairs: Pair[] = distorted.map((node, i) => ({
			px: node.x,
			py: node.y,
			qx: original.nodes[i].x,
			qy: original.nodes[i].y,
			w: 1 + original.nodes[i].degree,
		}));
		const transform = bestTransform(pairs);
		expect(transform).not.toBeNull();
		applyTransform(distorted, transform!);

		for (let i = 0; i < distorted.length; i += 1) {
			expect(Math.hypot(distorted[i].x - original.nodes[i].x, distorted[i].y - original.nodes[i].y)).toBeLessThan(1e-6);
		}
	});

	it('нет наложений: звёзды не налезают друг на друга', () => {
		const random = mulberry32(2024);
		const n = 80;
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		for (let i = 1; i < n; i += 1) {
			for (let k = 0; k < 2; k += 1) {
				const j = Math.floor(random() ** 2 * i);
				const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
				if (i === j || seen.has(key)) continue;
				seen.add(key);
				edges.push([Math.min(i, j), Math.max(i, j)]);
			}
		}

		const result = computeLayout({ ids: ids(n), edges, full: true });

		let worst = Infinity;
		for (let i = 0; i < result.nodes.length; i += 1) {
			for (let j = i + 1; j < result.nodes.length; j += 1) {
				const a = result.nodes[i];
				const b = result.nodes[j];
				const gap =
					Math.hypot(a.x - b.x, a.y - b.y) - starRadius(a.degree) - starRadius(b.degree);
				worst = Math.min(worst, gap);
			}
		}
		expect(worst).toBeGreaterThanOrEqual(0);
	});
});

// Корреляция Спирмена: сравниваем ранги, а не значения.
function spearman(a: number[], b: number[]): number {
	const rank = (values: number[]): number[] => {
		const order = values
			.map((value, index) => ({ value, index }))
			.sort((x, y) => x.value - y.value);
		const ranks = new Array<number>(values.length).fill(0);
		let i = 0;
		while (i < order.length) {
			let j = i;
			while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
			const average = (i + j) / 2 + 1;
			for (let k = i; k <= j; k += 1) ranks[order[k].index] = average;
			i = j + 1;
		}
		return ranks;
	};

	const ra = rank(a);
	const rb = rank(b);
	const n = a.length;
	const mean = (n + 1) / 2;
	let num = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < n; i += 1) {
		num += (ra[i] - mean) * (rb[i] - mean);
		da += (ra[i] - mean) ** 2;
		db += (rb[i] - mean) ** 2;
	}
	return num / Math.sqrt(da * db);
}
