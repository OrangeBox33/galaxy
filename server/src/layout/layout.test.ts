// Раскладка детерминирована, поэтому все проверки точные, без «примерно похоже».
import { describe, expect, it } from 'vitest';
import { computeLayout, type Point } from '../../../shared/layout/index.js';
import { LAYOUT_PARAMS as P, starRadius } from '../../../shared/layout/params.js';
import { makeNode, simulate, sunflowerPosition } from '../../../shared/layout/simulate.js';
import { computeCentrality } from '../../../shared/layout/centrality.js';
import { applyTransform, bestTransform, type Pair } from '../../../shared/layout/procrustes.js';
import { mulberry32 } from '../../../shared/prng.js';

const R = P.R_MAX;

type Graph = { ids: bigint[]; edges: [number, number][] };

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
		// Отталкивание от периферии гасится по симметрии — хабу остаётся только центр.
		const graph: Graph = { ids: ids(13), edges: star(0, 12, 1) };
		const result = computeLayout({ ...graph, full: true });

		const hub = result.nodes[0];
		expect(distance(hub)).toBeLessThan(0.08 * R);
	});

	it('двойная звезда: хабы расходятся симметрично вокруг общего центра', () => {
		const total = 26;
		const graph: Graph = {
			ids: ids(total),
			edges: [...star(0, 12, 2), ...star(1, 12, 14)],
		};

		// Центр масс — до нормализации: она сдвигает центроид в (0,0) арифметически.
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

		const result = computeLayout({ ...graph, full: true });
		const first = result.nodes[0];
		const second = result.nodes[1];
		const d1 = distance(first);
		const d2 = distance(second);

		expect(Math.min(d1, d2)).toBeGreaterThan(0.05 * R);
		expect(Math.abs(d1 - d2) / Math.max(d1, d2)).toBeLessThan(0.15);
		const cos = (first.x * second.x + first.y * second.y) / (d1 * d2);
		expect(cos).toBeLessThan(-0.85);
	});

	it('место в компании: кто знает своих лучше, тот ближе к её середине', () => {
		// Случай заказчика дословно: компания из 50, двое знают в ней всех.
		const BIG = 50;
		const SMALL = 14;
		const random = mulberry32(2024);
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		const link = (a: number, b: number): void => {
			if (a === b) return;
			const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
			if (seen.has(key)) return;
			seen.add(key);
			edges.push([Math.min(a, b), Math.max(a, b)]);
		};

		for (let i = 2; i < BIG; i += 1) {
			link(0, i);
			link(1, i);
		}
		link(0, 1);
		for (let i = 2; i < BIG; i += 1) {
			for (let k = 0; k < 2; k += 1) {
				link(i, 2 + Math.floor(random() * (BIG - 2)));
			}
		}

		// Вторая компания и мостик: иначе первая была бы всем небом.
		for (let i = BIG; i < BIG + SMALL; i += 1) {
			for (let j = i + 1; j < BIG + SMALL; j += 1) {
				if (random() < 0.5) link(i, j);
			}
			if (i + 1 < BIG + SMALL) link(i, i + 1);
		}
		link(2, BIG);

		const result = computeLayout({ ids: ids(BIG + SMALL), edges, full: true });

		const members = Array.from({ length: BIG }, (_, i) => i);
		const centre = {
			x: members.reduce((sum, i) => sum + result.nodes[i].x, 0) / BIG,
			y: members.reduce((sum, i) => sum + result.nodes[i].y, 0) / BIG,
		};
		const fromCentre = (i: number): number =>
			Math.hypot(result.nodes[i].x - centre.x, result.nodes[i].y - centre.y);

		// Связи внутри компании: мостик наружу в счёт не идёт.
		const inside = members.map(
			(i) => edges.filter(([a, b]) => (a === i && b < BIG) || (b === i && a < BIG)).length,
		);

		const distances = members.map(fromCentre);
		const ranked = [...distances].sort((a, b) => a - b);
		const median = ranked[Math.floor(ranked.length / 2)];

		expect(fromCentre(0)).toBeLessThan(median * 0.75);
		expect(fromCentre(1)).toBeLessThan(median * 0.75);

		const closer = (i: number): number => distances.filter((d) => d < fromCentre(i)).length;
		expect(closer(0)).toBeLessThan(6);
		expect(closer(1)).toBeLessThan(6);

		// Сравниваем четверти, а не ранговой связью по всем: у 48 из 50 число
		// своих связей почти одинаково, и Спирмен на них считает в основном шум.
		const byInside = members
			.map((i, k) => ({ i, inside: inside[k] }))
			.sort((a, b) => b.inside - a.inside);
		const quarter = Math.floor(BIG / 4);
		const mean = (list: { i: number }[]): number =>
			list.reduce((sum, entry) => sum + fromCentre(entry.i), 0) / list.length;
		expect(mean(byInside.slice(0, quarter))).toBeLessThan(mean(byInside.slice(-quarter)));
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

		const grownIds = [...ids(n), BigInt(n + 1)];
		const grownEdges: [number, number][] = [...edges, [0, n]];
		const grown = computeLayout({
			ids: grownIds,
			edges: grownEdges,
			previous,
			// Как на бою: без прошлого коэффициента растяжения пересчёт стартует
			// с растянутого неба и перетасует звёзды.
			previousScale: base.scale,
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

	it('новая связь не перетасовывает небо, в том числе в предсказании', () => {
		// Случай с боя: человек связывается с тем, у кого связей ещё нет.
		// Короткий прогон — то, чем клиент предсказывает результат сразу после
		// нажатия. Порог с запасом: замер даёт 47 и 48 единиц, а стоит потерять
		// previousScale по дороге — становится 141 и 160.
		const random = mulberry32(31337);
		const n = 60;
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		for (let i = 1; i < n; i += 1) {
			const j = Math.floor(random() ** 2 * i);
			const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
			if (i === j || seen.has(key)) continue;
			seen.add(key);
			edges.push([Math.min(i, j), Math.max(i, j)]);
		}

		// Ещё один человек, пока без единой связи.
		const lonely = n;
		const all = ids(n + 1);
		const base = computeLayout({ ids: all, edges, full: true });
		const previous = new Map<bigint, Point>(
			base.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
		);

		const linked: [number, number][] = [...edges, [3, lonely]];
		const moved = (maxIterations?: number): number => {
			const next = computeLayout({
				ids: all,
				edges: linked,
				previous,
				previousScale: base.scale,
				maxIterations,
			});
			const shifts = next.nodes
				.filter((node) => node.id !== BigInt(lonely + 1))
				.map((node) => {
					const old = previous.get(node.id)!;
					return Math.hypot(node.x - old.x, node.y - old.y);
				})
				.sort((a, b) => a - b);
			return shifts[Math.floor(shifts.length / 2)];
		};

		expect(moved()).toBeLessThan(0.06 * R);
		expect(moved(160)).toBeLessThan(0.06 * R);
	});

	it('прокруст: повёрнутая и отражённая раскладка возвращается на место', () => {
		const graph: Graph = { ids: ids(30), edges: star(0, 12, 1).concat(star(13, 8, 20)) };
		const original = computeLayout({ ...graph, full: true });

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
