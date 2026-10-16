// Рисунок созвездий: кратчайшее по длине на небе связывающее дерево из знакомств.

export type ConstellationPoint = { id: string; x: number; y: number; radius: number };

export type ConstellationLimits = {
	reach: number; // предел длины линии в медианах расстояния до ближайшего соседа, 0 — без предела
	maxDegree: number; // 0 — без ограничения
	maxSize: number; // звёзд в одном созвездии, 0 — без ограничения
};

type Grid = { cell: number; cells: Map<string, number[]> };

function gridOf(points: ConstellationPoint[], cell: number): Grid {
	const cells = new Map<string, number[]>();
	points.forEach((point, i) => {
		const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
		const list = cells.get(key);
		if (list) list.push(i);
		else cells.set(key, [i]);
	});
	return { cell, cells };
}

// Все, кто ближе grid.cell, гарантированно лежат в соседних девяти ячейках.
function forNear(grid: Grid, point: ConstellationPoint, visit: (j: number) => void): void {
	const gx = Math.floor(point.x / grid.cell);
	const gy = Math.floor(point.y / grid.cell);
	for (let dx = -1; dx <= 1; dx += 1) {
		for (let dy = -1; dy <= 1; dy += 1) {
			const list = grid.cells.get(`${gx + dx}:${gy + dy}`);
			if (list) for (const j of list) visit(j);
		}
	}
}

// Ячейка — среднее расстояние между звёздами, поэтому соседа дальше ячейки
// считаем бесконечно далёким: таких единицы процентов, медиану они не сдвигают.
function medianNearest(points: ConstellationPoint[]): number {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const { x, y } of points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const cell = Math.max(1, Math.sqrt(((maxX - minX) * (maxY - minY)) / points.length));
	const grid = gridOf(points, cell);
	const nearest = points.map((point, i) => {
		let best = Infinity;
		forNear(grid, point, (j) => {
			if (j === i) return;
			const d = Math.hypot(points[j].x - point.x, points[j].y - point.y);
			if (d <= cell && d < best) best = d;
		});
		return best;
	});
	nearest.sort((a, b) => a - b);
	const median = nearest[Math.floor(nearest.length / 2)];
	return Number.isFinite(median) ? median : cell;
}

function crosses(
	a: ConstellationPoint,
	b: ConstellationPoint,
	c: ConstellationPoint,
	d: ConstellationPoint,
): boolean {
	if (a === c || a === d || b === c || b === d) return false;
	const side = (p: ConstellationPoint, q: ConstellationPoint, r: ConstellationPoint): number =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function grazes(a: ConstellationPoint, b: ConstellationPoint, star: ConstellationPoint): boolean {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = ((star.x - a.x) * dx + (star.y - a.y) * dy) / (dx * dx + dy * dy);
	if (t <= 0 || t >= 1) return false;
	return Math.hypot(a.x + dx * t - star.x, a.y + dy * t - star.y) < star.radius;
}

export function buildConstellation(
	input: ConstellationPoint[],
	friendships: [string, string][],
	limits: ConstellationLimits,
): [string, string][] {
	if (input.length < 2) return [];
	// По id, а не в порядке прихода: /api/graph отдаёт узлы как попало, рисунок прыгал бы.
	const points = [...input].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
	const index = new Map(points.map((point, i) => [point.id, i]));
	const limit = limits.reach > 0 ? medianNearest(points) * limits.reach : Infinity;

	const pairs: { i: number; j: number; d: number }[] = [];
	for (const [aId, bId] of friendships) {
		const a = index.get(aId);
		const b = index.get(bId);
		if (a === undefined || b === undefined || a === b) continue;
		const [i, j] = a < b ? [a, b] : [b, a];
		const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
		if (d <= limit) pairs.push({ i, j, d });
	}
	pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);

	const parent = points.map((_, i) => i);
	const size = points.map(() => 1);
	const degree = points.map(() => 0);
	const root = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const maxDegree = limits.maxDegree > 0 ? limits.maxDegree : Infinity;
	const maxSize = limits.maxSize > 0 ? limits.maxSize : Infinity;

	const chosen: [number, number][] = [];
	const fits = (i: number, j: number): boolean =>
		root(i) !== root(j) &&
		degree[i] < maxDegree &&
		degree[j] < maxDegree &&
		size[root(i)] + size[root(j)] <= maxSize;
	const join = (i: number, j: number): void => {
		const ri = root(i);
		const rj = root(j);
		parent[ri] = rj;
		size[rj] += size[ri];
		degree[i] += 1;
		degree[j] += 1;
		chosen.push([i, j]);
	};

	const tangled: { i: number; j: number }[] = [];
	for (const { i, j } of pairs) {
		if (!fits(i, j)) continue;
		const a = points[i];
		const b = points[j];
		const crossing =
			chosen.some(([k, l]) => crosses(a, b, points[k], points[l])) ||
			points.some((star, k) => k !== i && k !== j && grazes(a, b, star));
		if (crossing) tangled.push({ i, j });
		else join(i, j);
	}
	// Пересекающая линия остаётся, только если других мостиков между частями нет.
	for (const { i, j } of tangled) if (fits(i, j)) join(i, j);

	return chosen.map(([i, j]) => [points[i].id, points[j].id]);
}
