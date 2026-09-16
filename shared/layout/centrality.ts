// Место звезды в небе центральность не определяет — его решают связи
// и компания. Нужна она только для порядка начальной расстановки и глубины
// (параллакса) на клиенте, поэтому хватает ранговой шкалы по числу связей:
// собственная центральность весила бы пару процентов, а стоила сотни
// умножений матрицы на вектор.

export type GraphInput = {
	// Стабильный порядок: от него зависит воспроизводимость раскладки.
	ids: bigint[];
	edges: [number, number][];
};

export type Centrality = {
	degree: number[];
	value: number[];
};

export function rankScale(values: number[]): number[] {
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
	const degree = new Array<number>(graph.ids.length).fill(0);
	for (const [a, b] of graph.edges) {
		degree[a] += 1;
		degree[b] += 1;
	}
	// Ранговая шкала, а не min-max (согласовано с заказчиком): распределение
	// степеней скошено, и min-max сжимает всех, кроме главного хаба, к краю.
	return { degree, value: rankScale(degree) };
}
