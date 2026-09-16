import type { Scene, Star } from './scene';

const K_EDGE = 0.055;
const K_HOME = 0.02;
const DAMPING = 0.86;
const SLEEP = 0.05;

export type Grab = { star: Star; worldX: number; worldY: number } | null;

export function stepWobble(scene: Scene, grab: Grab, dt: number): boolean {
	// Фиксированный шаг: при просадке кадров резинки не должны взрываться.
	const steps = Math.min(3, Math.max(1, Math.round(dt / 0.016)));
	let alive = false;

	for (let step = 0; step < steps; step += 1) {
		if (grab) {
			grab.star.ox = grab.worldX - grab.star.toX;
			grab.star.oy = grab.worldY - grab.star.toY;
			grab.star.ovx = 0;
			grab.star.ovy = 0;
		}

		for (const [a, b] of scene.edges) {
			const homeDx = a.toX - b.toX;
			const homeDy = a.toY - b.toY;
			const rest = Math.hypot(homeDx, homeDy);

			const dx = a.toX + a.ox - (b.toX + b.ox);
			const dy = a.toY + a.oy - (b.toY + b.oy);
			const distance = Math.hypot(dx, dy);
			if (distance < 1e-6) continue;

			const force = -K_EDGE * (distance - rest);
			const fx = (force * dx) / distance;
			const fy = (force * dy) / distance;

			// Масса та же, что в серверной раскладке: 1 + число связей.
			const massA = 1 + a.node.degree;
			const massB = 1 + b.node.degree;
			a.ovx += fx / massA;
			a.ovy += fy / massA;
			b.ovx -= fx / massB;
			b.ovy -= fy / massB;
		}

		for (const star of scene.order) {
			if (grab && star === grab.star) continue;

			star.ovx -= K_HOME * star.ox;
			star.ovy -= K_HOME * star.oy;

			star.ovx *= DAMPING;
			star.ovy *= DAMPING;
			star.ox += star.ovx;
			star.oy += star.ovy;

			if (Math.abs(star.ox) > SLEEP || Math.abs(star.oy) > SLEEP) alive = true;
			else if (Math.abs(star.ovx) > SLEEP || Math.abs(star.ovy) > SLEEP) alive = true;
		}
	}

	if (grab) return true;

	if (!alive) {
		for (const star of scene.order) {
			star.ox = 0;
			star.oy = 0;
			star.ovx = 0;
			star.ovy = 0;
		}
	}
	return alive;
}
