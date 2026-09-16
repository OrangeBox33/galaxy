// Пока поток считает секунду-две, основной отвечает на запросы.
import { parentPort } from 'node:worker_threads';
import { computeLayout, type LayoutInput, type LayoutResult } from '../../../shared/layout/index.js';

// Через границу потока BigInt не проходит — id ходят строками.
export type WorkerRequest = {
	ids: string[];
	edges: [number, number][];
	previous: [string, { x: number; y: number }][];
	anchors: [string, string][];
	full?: boolean;
	long?: boolean;
	previousScale?: number;
};

export type WorkerResponse = {
	nodes: {
		id: string;
		x: number;
		y: number;
		degree: number;
		centrality: number;
		cluster: number;
		component: number;
	}[];
	iterations: number;
	scale: number;
};

export function toInput(request: WorkerRequest): LayoutInput {
	return {
		ids: request.ids.map((id) => BigInt(id)),
		edges: request.edges,
		previous: new Map(request.previous.map(([id, point]) => [BigInt(id), point])),
		anchors: new Map(request.anchors.map(([id, anchor]) => [BigInt(id), BigInt(anchor)])),
		full: request.full,
		long: request.long,
		previousScale: request.previousScale,
	};
}

export function toResponse(result: LayoutResult): WorkerResponse {
	return {
		nodes: result.nodes.map((node) => ({ ...node, id: node.id.toString() })),
		iterations: result.iterations,
		scale: result.scale,
	};
}

parentPort?.on('message', (request: WorkerRequest) => {
	try {
		parentPort!.postMessage({ ok: true, result: toResponse(computeLayout(toInput(request))) });
	} catch (err) {
		parentPort!.postMessage({ ok: false, error: (err as Error).message });
	}
});
