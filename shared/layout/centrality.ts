// Центральность (раздел 7.1). Только подтверждённые связи; тестовые
// пользователи участвуют наравне с живыми.
import { LAYOUT_PARAMS } from './params.js';

export type GraphInput = {
	// Узлы в стабильном порядке: от него зависит воспроизводимость раскладки.
	ids: bigint[];
	// Рёбра как пары индексов в ids.
	edges: [number, number][];
};

export type Centrality = {
	degree: number[];
	eigen: number[];
	value: number[]; // ĉ ∈ [0,1]
};

// Нормировка в [0,1]. Если все значения равны — возвращаем нули:
// «все одинаковые» и «все в центре» — разные вещи, и второе нам не нужно.
function minMax(values: number[]): number[] {
	let min = Infinity;
	let max = -Infinity;
	for (const value of values) {
		if (value < min) min = value;
		if (value > max) max = value;
	}
	if (!Number.isFinite(min) || max === min) return values.map(() => 0);
	return values.map((value) => (value - min) / (max - min));
}

// Ранговая шкала в [0,1] со средним рангом для одинаковых значений.
function rankScale(values: number[]): number[] {
	const n = values.length;
	if (n === 0) return [];
	if (n === 1) return [0];

	const order = values
		.map((value, index) => ({ value, index }))
		.sort((a, b) => a.value - b.value);

	const result = new Array<number>(n).fill(0);
	let i = 0;
	while (i < n) {
		let j = i;
		while (j + 1 < n && order[j + 1].value === order[i].value) j += 1;
		const average = (i + j) / 2;
		for (let k = i; k <= j; k += 1) result[order[k].index] = average / (n - 1);
		i = j + 1;
	}
	return result;
}

export function computeCentrality(graph: GraphInput): Centrality {
	const n = graph.ids.length;
	const degree = new Array<number>(n).fill(0);
	const neighbours: number[][] = Array.from({ length: n }, () => []);

	for (const [a, b] of graph.edges) {
		degree[a] += 1;
		degree[b] += 1;
		neighbours[a].push(b);
		neighbours[b].push(a);
	}

	// Собственная центральность степенным методом: e'_i = Σ_{j∈N(i)} e_j
	// с нормировкой по L2 после каждой итерации. Изолированные узлы дадут 0.
	let eigen = new Array<number>(n).fill(n === 0 ? 0 : 1 / n);
	for (let iteration = 0; iteration < LAYOUT_PARAMS.EIGEN_ITERATIONS; iteration += 1) {
		const next = new Array<number>(n).fill(0);
		for (let i = 0; i < n; i += 1) {
			let sum = 0;
			for (const j of neighbours[i]) sum += eigen[j];
			next[i] = sum;
		}
		let norm = 0;
		for (const value of next) norm += value * value;
		norm = Math.sqrt(norm);
		if (norm === 0) {
			eigen = next;
			break;
		}
		eigen = next.map((value) => value / norm);
	}

	const degreeNorm = minMax(degree);
	const eigenNorm = minMax(eigen);

	const combined = degreeNorm.map(
		(value, i) => LAYOUT_PARAMS.W_DEGREE * value + LAYOUT_PARAMS.W_EIGEN * eigenNorm[i],
	);

	// Вместо второго min-max — ранговая шкала. Согласовано с заказчиком:
	// распределение степеней в живом графе скошено (у большинства 1–3 связи,
	// у пары человек — десятки), и min-max сжимает всех, кроме главного хаба,
	// к самому краю. Небо получается кольцом с пустой серединой. Ранг же
	// распределяет целевые радиусы равномерно, и «больше друзей — ближе
	// к центру» читается плавно по всей карте.
	//
	// Одинаковым значениям даётся одинаковый (средний) ранг, поэтому на пустом
	// небе, где у всех поровну связей, никто не получает преимущества:
	// все оказываются на одной окружности.
	return { degree, eigen, value: rankScale(minMax(combined)) };
}
