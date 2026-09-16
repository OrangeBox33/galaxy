// Симуляция свободна относительно поворота и отражения: без выравнивания
// по предыдущей раскладке (раздел 7.7, шаг 3) небо после пересчёта перевернётся.

export type Transform = { theta: number; mirror: boolean };

export type Pair = {
	px: number;
	py: number;
	qx: number;
	qy: number;
	w: number;
};

function bestAngle(pairs: Pair[], mirror: boolean): { theta: number; residual: number } {
	let num = 0;
	let den = 0;
	for (const pair of pairs) {
		const x = mirror ? -pair.px : pair.px;
		const y = pair.py;
		num += pair.w * (x * pair.qy - y * pair.qx);
		den += pair.w * (x * pair.qx + y * pair.qy);
	}
	const theta = Math.atan2(num, den);

	const cos = Math.cos(theta);
	const sin = Math.sin(theta);
	let residual = 0;
	for (const pair of pairs) {
		const x = mirror ? -pair.px : pair.px;
		const y = pair.py;
		const rx = cos * x - sin * y;
		const ry = sin * x + cos * y;
		residual += pair.w * ((rx - pair.qx) ** 2 + (ry - pair.qy) ** 2);
	}
	return { theta, residual };
}

export function bestTransform(pairs: Pair[]): Transform | null {
	if (pairs.length < 2) return null;

	const direct = bestAngle(pairs, false);
	const mirrored = bestAngle(pairs, true);

	return mirrored.residual < direct.residual
		? { theta: mirrored.theta, mirror: true }
		: { theta: direct.theta, mirror: false };
}

export function applyTransform<T extends { x: number; y: number }>(
	nodes: T[],
	transform: Transform,
): void {
	const cos = Math.cos(transform.theta);
	const sin = Math.sin(transform.theta);
	for (const node of nodes) {
		const x = transform.mirror ? -node.x : node.x;
		const y = node.y;
		node.x = cos * x - sin * y;
		node.y = sin * x + cos * y;
	}
}
