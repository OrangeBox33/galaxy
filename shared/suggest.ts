// «Возможные друзья»: друзья моих друзей, с которыми я ещё не знаком.
// Считается на клиенте — весь граф уже лежит в памяти после /api/graph,
// поэтому подсказки пересчитываются сразу после своего же «Связать»,
// не дожидаясь сервера. Стоит это суммы степеней моих друзей.

import { CLUSTER_ITERATIONS, findClusters } from './layout/clusters.js';

// Единицы мало: один общий друг — это почти любой встречный, и окно
// заполнялось бы случайными людьми.
export const MIN_MUTUAL = 2;

// Узел описан структурно, а не типом клиента: так математика лежит в общем
// коде и проверяется тестами сервера.
export type SuggestNode = { id: string; degree: number; isBlocked: boolean };

export type SuggestGraph<T extends SuggestNode> = {
	me: string;
	nodes: readonly T[];
	edges: readonly (readonly [string, string])[];
};

export type Suggestion<T extends SuggestNode> = {
	node: T;
	// Общие знакомые; они же задают порядок в списке.
	mutual: number;
};

export function suggestFriends<T extends SuggestNode>(
	graph: SuggestGraph<T>,
	dismissed: ReadonlySet<string>,
): Suggestion<T>[] {
	const neighbours = new Map<string, Set<string>>();
	for (const [a, b] of graph.edges) {
		if (!neighbours.has(a)) neighbours.set(a, new Set());
		if (!neighbours.has(b)) neighbours.set(b, new Set());
		neighbours.get(a)!.add(b);
		neighbours.get(b)!.add(a);
	}

	const mine = neighbours.get(graph.me);
	if (!mine || mine.size === 0) return [];

	const mutual = new Map<string, number>();
	for (const friend of mine) {
		for (const candidate of neighbours.get(friend) ?? []) {
			if (candidate === graph.me || mine.has(candidate)) continue;
			mutual.set(candidate, (mutual.get(candidate) ?? 0) + 1);
		}
	}

	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const out: Suggestion<T>[] = [];
	for (const [id, count] of mutual) {
		const node = byId.get(id);
		// Погасшие звёзды не предлагаем: связаться с ними всё равно нельзя.
		if (count < MIN_MUTUAL || !node || node.isBlocked || dismissed.has(id)) continue;
		out.push({ node, mutual: count });
	}

	// Больше общих друзей — выше, дальше кто ярче и лишь потом id: порядок
	// должен быть устойчивым, иначе список прыгал бы на каждом опросе графа.
	out.sort(
		(x, y) =>
			y.mutual - x.mutual ||
			y.node.degree - x.node.degree ||
			(x.node.id < y.node.id ? -1 : x.node.id > y.node.id ? 1 : 0),
	);
	return out;
}

// Добивка, когда друзей друзей не хватает: самый связный незнакомец из каждой
// компании, по одному на компанию, чтобы не предлагать троих из одной.
// Одиночек без связей не предлагаем: знакомить с ними некому.
export function suggestHubs<T extends SuggestNode>(
	graph: SuggestGraph<T>,
	dismissed: ReadonlySet<string>,
): T[] {
	// Метки сообществ зависят от порядка узлов, а /api/graph отдаёт его
	// произвольным: без сортировки компании перекраивались бы на каждом опросе.
	const nodes = [...graph.nodes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
	const index = new Map(nodes.map((node, i) => [node.id, i]));
	const neighbours: number[][] = nodes.map(() => []);
	const mine = new Set<string>();
	for (const [a, b] of graph.edges) {
		const i = index.get(a);
		const j = index.get(b);
		if (i === undefined || j === undefined) continue;
		neighbours[i].push(j);
		neighbours[j].push(i);
		if (a === graph.me) mine.add(b);
		if (b === graph.me) mine.add(a);
	}
	for (const list of neighbours) list.sort((x, y) => x - y);

	const { cluster } = findClusters(neighbours, CLUSTER_ITERATIONS);
	const best = new Map<number, T>();
	nodes.forEach((node, i) => {
		if (node.id === graph.me || mine.has(node.id) || node.isBlocked || dismissed.has(node.id)) return;
		if (node.degree === 0) return;
		const held = best.get(cluster[i]);
		if (!held || node.degree > held.degree) best.set(cluster[i], node);
	});

	return [...best.values()].sort(
		(x, y) => y.degree - x.degree || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
	);
}
