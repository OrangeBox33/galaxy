// Резинки: локальная физика для перетаскивания звезды пальцем.
//
// К общей карте это отношения не имеет. Серверные координаты остаются на месте,
// здесь считается только временное смещение от них: потянули звезду — соседи
// потянулись следом, отпустили — всё вернулось. Поэтому небо у всех одинаковое,
// а поиграть может каждый.
import type { Scene, Star } from './scene';

// Жёсткость связи между соседями: насколько сильно они тянут друг друга.
const K_EDGE = 0.055;
// Жёсткость возврата домой: именно она приводит всё обратно после отпускания.
const K_HOME = 0.02;
// Затухание. Чем ниже, тем быстрее успокаивается и тем меньше болтанки.
const DAMPING = 0.86;
// Смещение меньше этого считаем нулевым и физику останавливаем,
// чтобы в покое не тратить кадры впустую.
const SLEEP = 0.05;

export type Grab = { star: Star; worldX: number; worldY: number } | null;

// Один шаг. Возвращает true, если что-то ещё движется.
export function stepWobble(scene: Scene, grab: Grab, dt: number): boolean {
	// Физика считается фиксированным шагом: при просадке кадров резинки
	// не должны взрываться.
	const steps = Math.min(3, Math.max(1, Math.round(dt / 0.016)));
	let alive = false;

	for (let step = 0; step < steps; step += 1) {
		// Захваченная звезда просто стоит под пальцем.
		if (grab) {
			grab.star.ox = grab.worldX - grab.star.toX;
			grab.star.oy = grab.worldY - grab.star.toY;
			grab.star.ovx = 0;
			grab.star.ovy = 0;
		}

		for (const [a, b] of scene.edges) {
			// Длина покоя — расстояние между домашними местами: в покое
			// резинка не натянута и никого никуда не тащит.
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

			// Тяжёлая звезда поддаётся меньше: масса здесь та же, что
			// и в серверной раскладке, 1 + число связей.
			const massA = 1 + a.node.degree;
			const massB = 1 + b.node.degree;
			a.ovx += fx / massA;
			a.ovy += fy / massA;
			b.ovx -= fx / massB;
			b.ovy -= fy / massB;
		}

		for (const star of scene.order) {
			if (grab && star === grab.star) continue;

			// Возврат домой.
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

	// Когда всё почти улеглось — обнуляем начисто, иначе остаточная дрожь
	// будет вечно держать цикл физики включённым.
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
