// Тестовый граф для песочницы раскладки: в сборку не попадает. Та картина, на которой
// видно всё сразу: суперкластер, компании на мостиках, цепочка, пары и одиночки.
import { mulberry32 } from '../../../shared/prng';

export type Group = {
	key: string;
	label: string;
	color: string;
	from: number;
	to: number; // не включительно
};

export type TestGraph = {
	count: number;
	edges: [number, number][];
	groups: Group[];
	// К какой группе относится звезда — для раскраски схемы и подписи.
	groupOf: number[];
};

export type Shape = {
	seed: number;

	// Суперкластер: хабы заводятся сами предпочтительным присоединением, а не назначаются.
	hubCount: number;
	hubLinks: number; // сколько знакомств приносит с собой новичок
	hubExtra: number; // доля добавочных случайных связей поверх дерева

	// Тесная компания: почти все знают друг друга, наружу — считанные мостики.
	tightCount: number;
	tightDensity: number; // доля проведённых пар из всех возможных, 0…1
	tightBridges: number;

	// Компания посвободнее: связей внутри меньше, мостиков больше.
	midCount: number;
	midDensity: number;
	midBridges: number;

	chainCount: number; // цепочка, прицепленная к суперкластеру одним концом
	pairCount: number; // пары, не знакомые ни с кем
	lonerCount: number; // одиночки без единой связи
};

export const DEFAULT_SHAPE: Shape = {
	seed: 7,
	hubCount: 50,
	hubLinks: 2,
	hubExtra: 0.35,
	tightCount: 12,
	tightDensity: 0.75,
	tightBridges: 1,
	midCount: 14,
	midDensity: 0.35,
	midBridges: 2,
	chainCount: 7,
	pairCount: 5,
	lonerCount: 7,
};

const COLORS = {
	hub: '#7fb0ff',
	tight: '#ffd27f',
	mid: '#8be0a8',
	chain: '#d79cff',
	pair: '#ff9a9a',
	loner: '#8d9bb5',
};

export function buildTestGraph(shape: Shape): TestGraph {
	const random = mulberry32(shape.seed >>> 0);
	const edges: [number, number][] = [];
	const seen = new Set<string>();

	const link = (a: number, b: number): void => {
		if (a === b) return;
		const key = a < b ? `${a}:${b}` : `${b}:${a}`;
		if (seen.has(key)) return;
		seen.add(key);
		edges.push(a < b ? [a, b] : [b, a]);
	};

	const groups: Group[] = [];
	let next = 0;
	const block = (key: string, label: string, color: string, size: number): Group => {
		const group = { key, label, color, from: next, to: next + size };
		next += size;
		groups.push(group);
		return group;
	};

	const hub = block('hub', 'суперкластер', COLORS.hub, shape.hubCount);
	const tight = block('tight', 'тесная компания', COLORS.tight, shape.tightCount);
	const mid = block('mid', 'компания посвободнее', COLORS.mid, shape.midCount);
	const chain = block('chain', 'цепочка', COLORS.chain, shape.chainCount);
	const pairs = block('pair', 'пары', COLORS.pair, shape.pairCount * 2);
	const loners = block('loner', 'одиночки', COLORS.loner, shape.lonerCount);
	void loners;

	// Новичок цепляется к известным пропорционально их связям: несколько очень знакомых
	// и длинный хвост обычных, как в жизни.
	const draw: number[] = [];
	for (let i = hub.from; i < Math.min(hub.from + 2, hub.to); i += 1) draw.push(i);
	if (hub.to - hub.from >= 2) link(hub.from, hub.from + 1);

	for (let i = hub.from + 2; i < hub.to; i += 1) {
		const picked = new Set<number>();
		for (let k = 0; k < shape.hubLinks && picked.size < draw.length; k += 1) {
			for (let tries = 0; tries < 20; tries += 1) {
				const candidate = draw[Math.floor(random() * draw.length)];
				if (candidate !== i && !picked.has(candidate)) {
					picked.add(candidate);
					break;
				}
			}
		}
		for (const target of picked) {
			link(i, target);
			draw.push(target);
			draw.push(i);
		}
	}

	// Без хорд суперкластер — дерево, а «многие знают многих» требует треугольников.
	const hubSize = hub.to - hub.from;
	const extra = Math.round(shape.hubExtra * hubSize);
	for (let k = 0; k < extra; k += 1) {
		const a = hub.from + Math.floor(random() * hubSize);
		const b = hub.from + Math.floor(random() * hubSize);
		link(a, b);
	}

	const fill = (group: Group, density: number): void => {
		for (let i = group.from; i < group.to; i += 1) {
			// Сначала обод: компания обязана быть связной, иначе это не компания.
			if (i + 1 < group.to) link(i, i + 1);
			for (let j = i + 2; j < group.to; j += 1) {
				if (random() < density) link(i, j);
			}
		}
		if (group.to - group.from > 2) link(group.from, group.to - 1);
	};
	fill(tight, shape.tightDensity);
	fill(mid, shape.midDensity);

	const bridge = (group: Group, count: number): void => {
		for (let k = 0; k < count && group.to > group.from && hubSize > 0; k += 1) {
			const mine = group.from + Math.floor(random() * (group.to - group.from));
			const theirs = hub.from + Math.floor(random() * hubSize);
			link(mine, theirs);
		}
	};
	bridge(tight, shape.tightBridges);
	bridge(mid, shape.midBridges);

	for (let i = chain.from; i + 1 < chain.to; i += 1) link(i, i + 1);
	if (chain.to > chain.from && hubSize > 0) {
		link(chain.from, hub.from + Math.floor(random() * hubSize));
	}

	for (let i = pairs.from; i + 1 < pairs.to; i += 2) link(i, i + 1);

	return { count: next, edges, groups, groupOf: groupIndex(groups, next) };
}

function groupIndex(groups: Group[], count: number): number[] {
	const result = new Array<number>(count).fill(0);
	groups.forEach((group, index) => {
		for (let i = group.from; i < group.to; i += 1) result[i] = index;
	});
	return result;
}
