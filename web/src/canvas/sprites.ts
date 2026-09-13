// Спрайты свечения (раздел 8.3). Рисовать сотни радиальных градиентов каждый
// кадр нельзя, поэтому градиент отрисовывается один раз в offscreen-канвас
// на каждое сочетание «цвет ореола × ступень размера», а в кадре копируется.
import { haloKey, rgba, type RGB } from './palette';
import type { Gender } from '../../../shared/config';

// Двенадцать ступеней по геометрической прогрессии: между соседними разница
// около 30%, глазом переход не виден, а число спрайтов остаётся небольшим.
const STEPS = 12;
const MIN_RADIUS = 3;
const MAX_RADIUS = 220;

const ladder: number[] = Array.from({ length: STEPS }, (_, i) =>
	Math.round(MIN_RADIUS * (MAX_RADIUS / MIN_RADIUS) ** (i / (STEPS - 1))),
);

type Cache = Map<string, HTMLCanvasElement>;

let cache: Cache = new Map();
let cachedDpr = 0;

function build(color: RGB, radius: number, dpr: number): HTMLCanvasElement {
	const size = Math.ceil(radius * 2 * dpr);
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;

	const ctx = canvas.getContext('2d')!;
	const center = size / 2;
	const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
	// Плотное ядро и длинный мягкий хвост: так ореолы складываются в режиме
	// lighter похоже на настоящий свет, а не на матовые круги.
	gradient.addColorStop(0, rgba(color, 0.9));
	gradient.addColorStop(0.18, rgba(color, 0.55));
	gradient.addColorStop(0.45, rgba(color, 0.16));
	gradient.addColorStop(1, rgba(color, 0));

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	return canvas;
}

export function resetSprites(dpr: number): void {
	cache = new Map();
	cachedDpr = dpr;
}

// Возвращает спрайт ближайшей ступени; точный размер получается масштабом
// при отрисовке — визуально это неотличимо, зато не нужно пересобирать кеш
// на каждый кадр зума.
export function glowSprite(
	gender: Gender,
	isBlocked: boolean,
	color: RGB,
	radius: number,
	dpr: number,
): { sprite: HTMLCanvasElement; spriteRadius: number } {
	if (dpr !== cachedDpr) resetSprites(dpr);

	let step = ladder[ladder.length - 1];
	for (const candidate of ladder) {
		if (candidate >= radius) {
			step = candidate;
			break;
		}
	}

	const key = `${haloKey(gender, isBlocked)}:${step}`;
	let sprite = cache.get(key);
	if (!sprite) {
		sprite = build(color, step, dpr);
		cache.set(key, sprite);
	}
	return { sprite, spriteRadius: step };
}
