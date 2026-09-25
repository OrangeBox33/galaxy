// Рождение звезды: пыль сходится к точке, схлопывается и вспыхивает. Рисуется
// в экранных координатах уже спроецированной звезды и аддитивно, поверх ядра, —
// параллакс и зум достаются от рендерера даром.
import { clamp01, easeInOutCubic } from './animate';
import { rgba, type RGB } from './palette';

// Что делает сама звезда, пока идёт рождение: рендерер множит на это радиус
// и яркость венца с ядром, warmth — доля протозвёздного багрового в цвете.
export type BirthStar = { scale: number; alpha: number; warmth: number };

export type BirthScene = {
	ctx: CanvasRenderingContext2D;
	x: number;
	y: number;
	radius: number; // экранный радиус готовой звезды
	t: number; // 0…1
	seed: number;
};

export const PROTOSTAR: RGB = [0xff, 0x6a, 0x2c];
const WHITE: RGB = [0xff, 0xff, 0xff];
const TAU = Math.PI * 2;

// Пылинки не одного белого: холодные и тёплые оттенки вперемешку дают объём,
// а на аддитивном смешении цвет заметен только пока пыль летит порознь.
const DUST: RGB[] = [
	[0xff, 0xff, 0xff],
	[0xbf, 0xd8, 0xff],
	[0xff, 0xe2, 0xbf],
	[0xdb, 0xc6, 0xff],
	[0xc6, 0xff, 0xf0],
	[0xff, 0xc9, 0xd8],
];

// Панель песочницы правит эти числа на лету, поэтому они читаются каждый кадр.
export const birthTuning = {
	duration: 3600,
	particles: 200,
	from: 10, // откуда летит пыль, в радиусах звезды
	gather: 0.55, // доля времени до схлопывания
	swirl: 2.2, // закрутка на подлёте, радианы
	tail: 1.6,
	power: 6, // размер вспышки, в радиусах звезды
	warm: 0.3, // багровость зародыша до вспышки
	overshoot: 2, // во сколько раз звезда перелетает свой размер
	settle: 0.4, // доля времени на усадку после перелёта
};

const span = (t: number, from: number, to: number): number =>
	to <= from ? (t >= to ? 1 : 0) : clamp01((t - from) / (to - from));

const fract = (value: number): number => value - Math.floor(value);

function noise(seed: number, i: number, salt: number): number {
	return fract(Math.sin(seed * 12.9898 + i * 78.233 + salt * 37.719) * 43758.5453);
}

function halo(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	color: RGB,
	alpha: number,
): void {
	if (alpha <= 0.002 || radius <= 0.5) return;
	const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
	gradient.addColorStop(0, rgba(color, alpha));
	gradient.addColorStop(0.35, rgba(color, alpha * 0.45));
	gradient.addColorStop(1, rgba(color, 0));
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, TAU);
	ctx.fill();
}

export function birthStar(t: number): BirthStar {
	const T = birthTuning;
	if (t < T.gather) {
		return {
			scale: 0.05 + 0.1 * span(t, T.gather * 0.5, T.gather),
			alpha: 0.35 * span(t, 0.1, T.gather),
			warmth: T.warm * (1 - span(t, 0.2, T.gather)),
		};
	}

	const burst = span(t, T.gather, T.gather + 0.1);
	const settle = easeInOutCubic(span(t, T.gather + 0.1, T.gather + 0.1 + T.settle));
	return {
		scale: 0.15 + (T.overshoot - 0.15) * burst - (T.overshoot - 1) * settle,
		alpha: 1,
		warmth: 0,
	};
}

export function paintBirth({ ctx, x, y, radius, t, seed }: BirthScene): void {
	const T = birthTuning;
	const count = Math.round(T.particles);
	const width = Math.max(0.6, radius * 0.06);
	ctx.lineCap = 'round';
	ctx.lineWidth = width;

	for (let i = 0; i < count; i += 1) {
		// У каждой пылинки свой старт, свой радиус и своя скорость: без разброса
		// они держат строй и летят кольцом штрихов, а не облаком.
		const start = noise(seed, i, 3) * 0.3 * T.gather;
		const spread = 0.55 + 0.9 * noise(seed, i, 4);
		const p = span(t, start, T.gather * (0.72 + 0.4 * noise(seed, i, 5)));
		if (p <= 0 || p >= 1) continue;

		// Квадрат, а не линейный ход: пыль разгоняется к середине, как под тяготением.
		const fall = p * p;
		const distance = radius * T.from * spread * (1 - fall);
		const angle = noise(seed, i, 1) * TAU + T.swirl * fall;
		const px = x + Math.cos(angle) * distance;
		const py = y + Math.sin(angle) * distance;
		const tail = radius * T.tail * spread * (0.3 + 0.7 * p);
		const toX = px + Math.cos(angle) * tail;
		const toY = py + Math.sin(angle) * tail;
		const tint = DUST[Math.floor(noise(seed, i, 2) * DUST.length) % DUST.length];

		const trail = ctx.createLinearGradient(px, py, toX, toY);
		trail.addColorStop(0, rgba(tint, 0.15 + 0.5 * p));
		trail.addColorStop(1, rgba(tint, 0));
		ctx.strokeStyle = trail;
		ctx.beginPath();
		ctx.moveTo(px, py);
		ctx.lineTo(toX, toY);
		ctx.stroke();
	}

	const burst = span(t, T.gather - 0.04, T.gather + 0.22);
	if (burst > 0 && burst < 1) {
		const power = Math.sin(burst * Math.PI) ** 2;
		halo(ctx, x, y, radius * T.power * power, WHITE, 0.8 * power);
		halo(ctx, x, y, radius * T.power * 1.8 * power, WHITE, 0.4 * power);
	}
}
