// Личный множитель числа языков: выдаётся один раз при первом входе и хранится
// в БД — звезда должна оставаться узнаваемой.
const FLAME_MIN = 0.55;
const FLAME_STEP = 0.05;
const FLAME_STEPS = 10;

export function randomFlame(): number {
	const step = Math.floor(Math.random() * FLAME_STEPS);
	return Number((FLAME_MIN + step * FLAME_STEP).toFixed(2));
}
