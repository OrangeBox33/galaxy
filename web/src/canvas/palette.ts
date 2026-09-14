// Палитра неба (раздел 8.1–8.2).
import type { Gender } from '../../../shared/config';

export const SKY_TOP = '#04060E';
export const SKY_MID = '#0A0E1C';
export const SKY_BOTTOM = '#060811';

export const CORE = '#F4F8FF';
// То же значение числами: ядро смешивается с оттенком звезды.
export const CORE_RGB: RGB = [0xf4, 0xf8, 0xff];

// Раньше цвет звезды зависел от пола: синеватый у мужчин, розоватый у женщин
// (раздел 8.1 ТЗ). Заказчик отказался от этого: звёзды белые, а цвет — то,
// что человек однажды выберет себе сам. Заблокированный остаётся серым.
const STAR_WHITE: RGB = [0xff, 0xff, 0xff];
const BLOCKED: RGB = [0x4b, 0x55, 0x62];

export type RGB = [number, number, number];

export function mix(base: RGB, tint: RGB, amount: number): RGB {
	return [
		Math.round(base[0] + (tint[0] - base[0]) * amount),
		Math.round(base[1] + (tint[1] - base[1]) * amount),
		Math.round(base[2] + (tint[2] - base[2]) * amount),
	];
}

export function haloColor(gender: Gender, isBlocked: boolean): RGB {
	void gender;
	return isBlocked ? BLOCKED : STAR_WHITE;
}

export function rgba(color: RGB, alpha: number): string {
	return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function rgb(color: RGB): string {
	return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
