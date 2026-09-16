// Кто с кем «одна компания»: внутри компании своя середина, между компаниями
// отталкивание сильнее — из скопления получается рисунок.
//
// Детерминированность обязательна, как и во всей раскладке: узлы обходятся
// по индексу (он задан порядком ids), ничьи разрешаются меньшей меткой.
import { rankScale } from './centrality.js';

export type Clusters = {
	component: number[];
	// Индекс сообщества (label propagation): внутри компоненты их может быть
	// несколько, у разных компонент сообщества заведомо разные.
	cluster: number[];
	// Те же сообщества, но номерами подряд 0…groupCount−1: по ним раскладываются
	// центроиды в массивы на каждой итерации.
	group: number[];
	groupCount: number;
	groupSize: number[];
	// Насколько звезда центральна внутри своей компании: 1 — знает в ней всех.
	// Ранговая шкала по связям внутри компании, поэтому сравнивать этим числом
	// разные компании нельзя — оно своё в каждой.
	localCentrality: number[];
};

export function findClusters(neighbours: number[][], iterations: number): Clusters {
	const n = neighbours.length;
	const component = components(neighbours, n);
	const cluster = propagate(neighbours, n, iterations);

	// Метки после propagate — это чьи-то индексы вразброс.
	const dense = new Map<number, number>();
	const group = new Array<number>(n);
	for (let i = 0; i < n; i += 1) {
		let id = dense.get(cluster[i]);
		if (id === undefined) {
			id = dense.size;
			dense.set(cluster[i], id);
		}
		group[i] = id;
	}
	const groupCount = dense.size;

	const groupSize = new Array<number>(groupCount).fill(0);
	for (let i = 0; i < n; i += 1) groupSize[group[i]] += 1;

	return { component, cluster, group, groupCount, groupSize, localCentrality: local(neighbours, group, groupCount, n) };
}

// Центральность внутри компании. Связи наружу не в счёт — иначе мостик
// вытаскивал бы звезду в середину компании, где она почти никого не знает.
function local(neighbours: number[][], group: number[], groupCount: number, n: number): number[] {
	const inside = new Array<number>(n).fill(0);
	for (let i = 0; i < n; i += 1) {
		for (const j of neighbours[i]) if (group[j] === group[i]) inside[i] += 1;
	}

	const members: number[][] = Array.from({ length: groupCount }, () => []);
	for (let i = 0; i < n; i += 1) members[group[i]].push(i);

	const result = new Array<number>(n).fill(0);
	for (const list of members) {
		// Одинаковым — средний ранг: пара равных звёзд не расходится
		// «кто из вас главнее».
		const scaled = rankScale(list.map((i) => inside[i]));
		list.forEach((i, k) => (result[i] = scaled[k]));
	}
	return result;
}

function components(neighbours: number[][], n: number): number[] {
	const component = new Array<number>(n).fill(-1);
	let next = 0;
	const stack: number[] = [];

	for (let start = 0; start < n; start += 1) {
		if (component[start] !== -1) continue;
		const id = next;
		next += 1;
		component[start] = id;
		stack.push(start);
		while (stack.length > 0) {
			const node = stack.pop()!;
			for (const neighbour of neighbours[node]) {
				if (component[neighbour] !== -1) continue;
				component[neighbour] = id;
				stack.push(neighbour);
			}
		}
	}
	return component;
}

// Каждый узел берёт метку, которая чаще всего встречается у его соседей.
// На графах нашего размера сходится за два-три десятка проходов; не сойдётся —
// останется чуть более дробное разбиение, для сил это не беда.
function propagate(neighbours: number[][], n: number, iterations: number): number[] {
	const label = new Array<number>(n);
	for (let i = 0; i < n; i += 1) label[i] = i;

	const votes = new Map<number, number>();
	for (let step = 0; step < iterations; step += 1) {
		let changed = false;
		for (let i = 0; i < n; i += 1) {
			if (neighbours[i].length === 0) continue;
			votes.clear();
			for (const neighbour of neighbours[i]) {
				const key = label[neighbour];
				votes.set(key, (votes.get(key) ?? 0) + 1);
			}
			let best = label[i];
			let bestCount = -1;
			for (const [key, count] of votes) {
				// Ничья — за меньшей меткой: иначе результат зависел бы
				// от порядка обхода Map.
				if (count > bestCount || (count === bestCount && key < best)) {
					best = key;
					bestCount = count;
				}
			}
			if (best !== label[i]) {
				label[i] = best;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return label;
}
