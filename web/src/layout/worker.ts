import { computeLayout } from '../../../shared/layout/index';

export type PredictRequest = {
	ids: string[];
	edges: [number, number][];
	previous: [string, { x: number; y: number }][];
	maxIterations?: number;
};

export type PredictedNode = {
	id: string;
	x: number;
	y: number;
	degree: number;
	centrality: number;
};

export type PredictResponse = { nodes: PredictedNode[] };

self.onmessage = (event: MessageEvent<PredictRequest>) => {
	const request = event.data;
	const result = computeLayout({
		ids: request.ids.map((id) => BigInt(id)),
		edges: request.edges,
		previous: new Map(request.previous.map(([id, point]) => [BigInt(id), point])),
		maxIterations: request.maxIterations,
	});

	const response: PredictResponse = {
		nodes: result.nodes.map((node) => ({ ...node, id: node.id.toString() })),
	};
	self.postMessage(response);
};
