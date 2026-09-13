// Раскладка в отдельном потоке. Сам расчёт — чистая математика без ввода-вывода,
// поэтому выносится целиком: пока поток считает свои секунду-две, основной
// продолжает отвечать на запросы. Иначе при двух сотнях звёзд каждое изменение
// графа подвешивало бы весь сервис.
import { parentPort } from 'node:worker_threads';
import { computeLayout, type LayoutInput, type LayoutResult } from '../../../shared/layout/index.js';

// Через границу потока BigInt не проходит структурированным клонированием
// молча — id ходят строками, как и во всём остальном API.
export type WorkerRequest = {
	ids: string[];
	edges: [number, number][];
	previous: [string, { x: number; y: number }][];
	anchors: [string, string][];
	full?: boolean;
	long?: boolean;
};

export type WorkerResponse = {
	nodes: { id: string; x: number; y: number; degree: number; centrality: number }[];
	iterations: number;
};

export function toInput(request: WorkerRequest): LayoutInput {
	return {
		ids: request.ids.map((id) => BigInt(id)),
		edges: request.edges,
		previous: new Map(request.previous.map(([id, point]) => [BigInt(id), point])),
		anchors: new Map(request.anchors.map(([id, anchor]) => [BigInt(id), BigInt(anchor)])),
		full: request.full,
		long: request.long,
	};
}

export function toResponse(result: LayoutResult): WorkerResponse {
	return {
		nodes: result.nodes.map((node) => ({ ...node, id: node.id.toString() })),
		iterations: result.iterations,
	};
}

parentPort?.on('message', (request: WorkerRequest) => {
	try {
		parentPort!.postMessage({ ok: true, result: toResponse(computeLayout(toInput(request))) });
	} catch (err) {
		parentPort!.postMessage({ ok: false, error: (err as Error).message });
	}
});
