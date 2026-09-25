// Цепочка знакомств между двумя людьми и общие друзья. Считается на клиенте:
// весь граф уже в памяти после /api/graph, а ждать сервер, держа палец
// на звезде, незачем. На 300 звёздах обход в ширину — доли миллисекунды.

export type Neighbours = Map<string, Set<string>>;

export function neighbourMap(edges: readonly (readonly [string, string])[]): Neighbours {
	const map: Neighbours = new Map();
	for (const [a, b] of edges) {
		if (!map.has(a)) map.set(a, new Set());
		if (!map.has(b)) map.set(b, new Set());
		map.get(a)!.add(b);
		map.get(b)!.add(a);
	}
	return map;
}

// Соседи перебираются по возрастанию id: кратчайших путей обычно несколько,
// а /api/graph отдаёт связи в произвольном порядке — без сортировки цепочка
// перекладывалась бы на другой такой же путь на каждом опросе графа.
export function shortestPath(
	neighbours: Neighbours,
	from: string,
	to: string,
): string[] | null {
	if (from === to) return [from];

	const cameFrom = new Map<string, string>();
	const seen = new Set([from]);
	let frontier = [from];

	while (frontier.length > 0) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const neighbour of [...(neighbours.get(id) ?? [])].sort()) {
				if (seen.has(neighbour)) continue;
				seen.add(neighbour);
				cameFrom.set(neighbour, id);
				if (neighbour === to) return walkBack(cameFrom, from, to);
				next.push(neighbour);
			}
		}
		frontier = next;
	}
	return null;
}

function walkBack(cameFrom: Map<string, string>, from: string, to: string): string[] {
	const chain = [to];
	let cursor = to;
	while (cursor !== from) {
		cursor = cameFrom.get(cursor)!;
		chain.push(cursor);
	}
	return chain.reverse();
}

export function mutualFriends(neighbours: Neighbours, a: string, b: string): number {
	const mine = neighbours.get(a);
	const theirs = neighbours.get(b);
	if (!mine || !theirs) return 0;

	let count = 0;
	for (const id of mine) if (theirs.has(id)) count += 1;
	return count;
}
