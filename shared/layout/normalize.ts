// Нормализация раскладки перед записью (раздел 7.7, шаги 1–2).
import { LAYOUT_PARAMS as P } from './params.js';

type Node = { x: number; y: number; mass: number };

// Сдвиг так, чтобы взвешенный по массам центроид оказался в (0,0).
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

// Масштаб так, чтобы 95-й процентиль радиусов равнялся R_MAX. По процентилю,
// а не по максимуму: один улетевший одиночка не должен сжимать всё небо.
export function scaleToPercentile(nodes: Node[]): void {
	if (nodes.length === 0) return;
	const radii = nodes.map((node) => Math.hypot(node.x, node.y)).sort((a, b) => a - b);
	const index = Math.min(
		radii.length - 1,
		Math.max(0, Math.round(P.SCALE_PERCENTILE * (radii.length - 1))),
	);
	const reference = radii[index];
	if (reference < 1e-9) return;
	const scale = P.R_MAX / reference;
	for (const node of nodes) {
		node.x *= scale;
		node.y *= scale;
	}
}
