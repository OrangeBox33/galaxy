// Палитра неба (раздел 8.1–8.2). Оттенок пола обязан читаться как намёк,
// а не как раскраска: рядом стоящие звёзды отличаются заметно, но небо
// в целом остаётся серебристо-белым.
import type { Gender } from '../../../shared/config';

export const SKY_TOP = '#04060E';
export const SKY_MID = '#0A0E1C';
export const SKY_BOTTOM = '#060811';

export const CORE = '#F4F8FF';
const HALO_BASE: RGB = [0xc8, 0xd8, 0xff];
const MALE_TINT: RGB = [0x6f, 0xa8, 0xff];
const FEMALE_TINT: RGB = [0xff, 0x8f, 0xc0];
const BLOCKED: RGB = [0x4b, 0x55, 0x62];

export type RGB = [number, number, number];

function mix(base: RGB, tint: RGB, amount: number): RGB {
	return [
		Math.round(base[0] + (tint[0] - base[0]) * amount),
		Math.round(base[1] + (tint[1] - base[1]) * amount),
		Math.round(base[2] + (tint[2] - base[2]) * amount),
	];
}

const MALE_HALO = mix(HALO_BASE, MALE_TINT, 0.35);
const FEMALE_HALO = mix(HALO_BASE, FEMALE_TINT, 0.3);

export function haloColor(gender: Gender, isBlocked: boolean): RGB {
	if (isBlocked) return BLOCKED;
	if (gender === 'MALE') return MALE_HALO;
	if (gender === 'FEMALE') return FEMALE_HALO;
	return HALO_BASE;
}

// Ключ для кеша спрайтов: цветов всего четыре.
export function haloKey(gender: Gender, isBlocked: boolean): string {
	if (isBlocked) return 'blocked';
	return gender;
}

export function rgba(color: RGB, alpha: number): string {
	return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function rgb(color: RGB): string {
	return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
