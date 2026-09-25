import type { Gender } from '../../../shared/config';

export const SKY_TOP = '#04060E';
export const SKY_MID = '#0A0E1C';
export const SKY_BOTTOM = '#060811';

export const CORE = '#F4F8FF';
export const CORE_RGB: RGB = [0xf4, 0xf8, 0xff];

// Звёзды белые: цвет не зависит от пола.
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

// "#RRGGBB" из личных настроек человека; мусор игнорируем, цвет останется прежним.
export function parseHex(value: string | null | undefined): RGB | null {
	if (!value) return null;
	const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
	if (!match) return null;
	const number = parseInt(match[1], 16);
	return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function rgba(color: RGB, alpha: number): string {
	return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function rgb(color: RGB): string {
	return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
