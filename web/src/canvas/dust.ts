// Декоративная звёздная пыль (раздел 8.1). Это фон, а не пользователи:
// по ней нельзя кликнуть. Рисуется один раз в offscreen-канвас и дальше
// просто копируется, двигаясь с параллаксом 0.25 от камеры.
import { mulberry32 } from './prng';

const COUNT = 600;
const TILE = 1024;

let tile: HTMLCanvasElement | null = null;

export function dustTile(): HTMLCanvasElement {
	if (tile) return tile;

	const canvas = document.createElement('canvas');
	canvas.width = TILE;
	canvas.height = TILE;
	const ctx = canvas.getContext('2d')!;

	// Зерно фиксировано: пыль должна быть одна и та же при каждом заходе.
	const random = mulberry32(0x5eed);
	for (let i = 0; i < COUNT; i += 1) {
		const x = random() * TILE;
		const y = random() * TILE;
		const radius = 0.4 + random() * 0.7;
		const alpha = 0.05 + random() * 0.2;
		ctx.fillStyle = `rgba(226, 234, 255, ${alpha})`;
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	tile = canvas;
	return tile;
}

export const DUST_TILE_SIZE = TILE;
export const DUST_PARALLAX = 0.25;
