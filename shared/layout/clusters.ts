// Компания — связная часть неба. Сообщества (label propagation, Лувен) пробовались:
// одна связь перекраивала разбиение у всех и двигала небо на 700 единиц из 1400.
import { rankScale } from './centrality.js';

export type Clusters = {
	group: number[];
	groupCount: number;
	groupSize: number[];
	// Насколько звезда центральна внутри своей компании: 1 — знает в ней всех.
	// Ранговая шкала по связям внутри компании, поэтому сравнивать этим числом
	// разные компании нельзя — оно своё в каждой.
	localCentrality: number[];
};

export function findClusters(neighbours: number[][]): Clusters {
	const n = neighbours.length;
	const group = components(neighbours, n);
	const groupCount = n === 0 ? 0 : Math.max(...group) + 1;

	const groupSize = new Array<number>(groupCount).fill(0);
	for (let i = 0; i < n; i += 1) groupSize[group[i]] += 1;

	return { group, groupCount, groupSize, localCentrality: local(neighbours, group, groupCount, n) };
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
