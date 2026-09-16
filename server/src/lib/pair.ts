// Связь ненаправленная и хранится как aId < bId: (a,b) и (b,a) — одна строка.
export function normalizePair(x: bigint, y: bigint): [bigint, bigint] {
	return x < y ? [x, y] : [y, x];
}
