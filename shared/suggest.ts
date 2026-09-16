// «Возможные друзья»: друзья моих друзей, с которыми я ещё не знаком.
// Считается на клиенте — весь граф уже лежит в памяти после /api/graph,
// поэтому подсказки пересчитываются сразу после своего же «Связать»,
// не дожидаясь сервера. Стоит это суммы степеней моих друзей.

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
