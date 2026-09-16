// Клиентский расчёт не обязан совпасть с серверным: точность sin/cos у движков разная.
import type { Graph } from '../api/types';
import type { PredictedNode, PredictRequest, PredictResponse } from './worker';

const PREDICT_ITERATIONS = 160;
const TIMEOUT_MS = 4000;

let worker: Worker | null = null;

function ensureWorker(): Worker | null {
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	} catch {
		worker = null;
	}
	return worker;
}

export type Prediction = Map<string, PredictedNode>;

export function predictLayout(graph: Graph, edges: [string, string][]): Promise<Prediction | null> {
	const instance = ensureWorker();
	if (!instance) return Promise.resolve(null);

	const ids = graph.nodes.map((node) => node.id);
	const index = new Map(ids.map((id, i) => [id, i]));

	const request: PredictRequest = {
		ids,
		edges: edges
			.map(([a, b]) => [index.get(a), index.get(b)])
			.filter((pair): pair is [number, number] => pair[0] !== undefined && pair[1] !== undefined),
		previous: graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
		previousScale: graph.layoutScale,
		maxIterations: PREDICT_ITERATIONS,
	};

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			instance.removeEventListener('message', onMessage);
			resolve(null);
		}, TIMEOUT_MS);

		function onMessage(event: MessageEvent<PredictResponse>): void {
			clearTimeout(timer);
			instance!.removeEventListener('message', onMessage);
			resolve(new Map(event.data.nodes.map((node) => [node.id, node])));
		}

		instance.addEventListener('message', onMessage);
		instance.postMessage(request);
	});
}
