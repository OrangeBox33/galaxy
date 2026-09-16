import { LAYOUT_PARAMS, type LayoutParams } from './params.js';

type Node = { x: number; y: number; mass: number };

export function centerByMass(nodes: Node[]): void {
	if (nodes.length === 0) return;
	let sumX = 0;
	let sumY = 0;
	let sumMass = 0;
	for (const node of nodes) {
		sumX += node.x * node.mass;
		sumY += node.y * node.mass;
		sumMass += node.mass;
	}
	if (sumMass === 0) return;
	const cx = sumX / sumMass;
	const cy = sumY / sumMass;
	for (const node of nodes) {
		node.x -= cx;
		node.y -= cy;
	}
}

// Во сколько раз растянуть небо, чтобы его SCALE_PERCENTILE-й радиус стал R_MAX.
export function percentileScale(nodes: Node[], params: LayoutParams = LAYOUT_PARAMS): number {
	if (nodes.length === 0) return 1;
	const radii = nodes.map((node) => Math.hypot(node.x, node.y)).sort((a, b) => a - b);
	const index = Math.min(
		radii.length - 1,
		Math.max(0, Math.round(params.SCALE_PERCENTILE * (radii.length - 1))),
	);
	const reference = radii[index];
	if (reference < 1e-9) return 1;
	return params.R_MAX / reference;
}

export function scaleToPercentile(nodes: Node[], params: LayoutParams = LAYOUT_PARAMS): void {
	scaleTo(nodes, params.R_MAX, params);
}

export function scaleTo(
	nodes: Node[],
	targetRadius: number,
	params: LayoutParams = LAYOUT_PARAMS,
): void {
	if (!(targetRadius > 0)) return;
	const scale = percentileScale(nodes, params) * (targetRadius / params.R_MAX);
	if (scale === 1) return;
	for (const node of nodes) {
		node.x *= scale;
		node.y *= scale;
	}
}

export function percentileRadius(
	points: { x: number; y: number }[],
	params: LayoutParams = LAYOUT_PARAMS,
): number {
	if (points.length === 0) return 0;
	const radii = points.map((p) => Math.hypot(p.x, p.y)).sort((a, b) => a - b);
	const index = Math.min(
		radii.length - 1,
		Math.max(0, Math.round(params.SCALE_PERCENTILE * (radii.length - 1))),
	);
	return radii[index];
}
